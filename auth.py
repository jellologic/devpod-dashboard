"""HTTP Basic Auth and host IP detection."""

import base64
import socket

from . import config

HOST_IP = None


def get_host_ip():
    global HOST_IP
    if HOST_IP:
        return HOST_IP
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        HOST_IP = s.getsockname()[0]
        s.close()
    except Exception:
        HOST_IP = "127.0.0.1"
    return HOST_IP


def check_auth(handler):
    auth = handler.headers.get("Authorization", "")
    if auth.startswith("Basic "):
        try:
            decoded = base64.b64decode(auth[6:]).decode("utf-8")
            user, password = decoded.split(":", 1)
            if user == config.AUTH_USER and password == config.AUTH_PASS:
                return True
        except Exception:
            pass
    handler.send_response(401)
    handler.send_header("WWW-Authenticate", 'Basic realm="DevPod Dashboard"')
    handler.send_header("Content-Type", "text/plain")
    handler.end_headers()
    handler.wfile.write(b"Unauthorized")
    return False
