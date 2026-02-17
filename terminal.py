"""WebSocket terminal - manual RFC 6455 + kubectl exec bridge."""

import base64
import hashlib
import struct
import subprocess
import threading

from . import config
from .workspaces import touch_last_accessed

WS_MAGIC = "258EAFA5-E914-47DA-95CA-5B8B13686178"


def websocket_handshake(handler):
    """Perform WebSocket upgrade handshake. Returns True on success."""
    key = handler.headers.get("Sec-WebSocket-Key", "")
    if not key:
        handler.send_response(400)
        handler.end_headers()
        return False

    accept = base64.b64encode(
        hashlib.sha1((key + WS_MAGIC).encode()).digest()
    ).decode()

    handler.send_response(101)
    handler.send_header("Upgrade", "websocket")
    handler.send_header("Connection", "Upgrade")
    handler.send_header("Sec-WebSocket-Accept", accept)
    handler.end_headers()
    return True


def ws_read_frame(sock):
    """Read one WebSocket frame. Returns (opcode, payload) or (None, None) on error."""
    try:
        hdr = _recv_exact(sock, 2)
        if not hdr:
            return None, None

        opcode = hdr[0] & 0x0F
        masked = bool(hdr[1] & 0x80)
        length = hdr[1] & 0x7F

        if length == 126:
            raw = _recv_exact(sock, 2)
            if not raw:
                return None, None
            length = struct.unpack("!H", raw)[0]
        elif length == 127:
            raw = _recv_exact(sock, 8)
            if not raw:
                return None, None
            length = struct.unpack("!Q", raw)[0]

        mask_key = _recv_exact(sock, 4) if masked else None
        if masked and not mask_key:
            return None, None

        payload = _recv_exact(sock, length) if length else b""
        if payload is None:
            return None, None

        if masked and mask_key:
            payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))

        return opcode, payload
    except Exception:
        return None, None


def ws_send_frame(sock, payload, opcode=0x02):
    """Send a WebSocket frame (binary by default)."""
    frame = bytearray()
    frame.append(0x80 | opcode)  # FIN + opcode

    length = len(payload)
    if length < 126:
        frame.append(length)
    elif length < 65536:
        frame.append(126)
        frame.extend(struct.pack("!H", length))
    else:
        frame.append(127)
        frame.extend(struct.pack("!Q", length))

    frame.extend(payload if isinstance(payload, (bytes, bytearray)) else payload.encode())
    try:
        sock.sendall(bytes(frame))
    except Exception:
        pass


def handle_terminal(handler, pod_name):
    """Upgrade to WebSocket and bridge kubectl exec stdin/stdout."""
    if not websocket_handshake(handler):
        return

    # Touch last-accessed for expiry tracking
    touch_last_accessed(pod_name)

    sock = handler.request  # raw socket
    done = threading.Event()

    cmd = [
        "kubectl", "--kubeconfig", config.KUBECONFIG,
        "-n", config.NAMESPACE,
        "exec", "-i", pod_name, "--", "/bin/sh",
    ]

    try:
        proc = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
    except Exception as e:
        ws_send_frame(sock, f"Failed to exec: {e}".encode(), opcode=0x01)
        _ws_close(sock)
        return

    def _reader():
        """Read kubectl stdout and send as WebSocket binary frames."""
        try:
            while not done.is_set():
                data = proc.stdout.read(4096)
                if not data:
                    break
                ws_send_frame(sock, data, opcode=0x02)
        except Exception:
            pass
        finally:
            done.set()

    reader_thread = threading.Thread(target=_reader, daemon=True)
    reader_thread.start()

    # Main loop: read WebSocket frames, write to process stdin
    try:
        while not done.is_set():
            opcode, payload = ws_read_frame(sock)
            if opcode is None or opcode == 0x08:  # close frame
                break
            if opcode == 0x09:  # ping
                ws_send_frame(sock, payload or b"", opcode=0x0A)
                continue
            if payload:
                try:
                    proc.stdin.write(payload)
                    proc.stdin.flush()
                except Exception:
                    break
    except Exception:
        pass
    finally:
        done.set()
        try:
            proc.stdin.close()
        except Exception:
            pass
        try:
            proc.kill()
        except Exception:
            pass
        try:
            proc.wait(timeout=3)
        except Exception:
            pass
        _ws_close(sock)
        reader_thread.join(timeout=2)


def _ws_close(sock):
    """Send WebSocket close frame."""
    try:
        ws_send_frame(sock, struct.pack("!H", 1000), opcode=0x08)
    except Exception:
        pass


def _recv_exact(sock, n):
    """Read exactly n bytes from socket."""
    data = bytearray()
    while len(data) < n:
        try:
            chunk = sock.recv(n - len(data))
            if not chunk:
                return None
            data.extend(chunk)
        except Exception:
            return None
    return bytes(data)
