"""HTTP Basic Auth (multi-user aware) and host IP detection."""

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
    """Authenticate the request. Returns username string on success, empty string on failure.

    If config.users is populated (multi-user mode), validates against users dict.
    Otherwise falls back to AUTH_USER/AUTH_PASS and returns "admin".
    """
    auth = handler.headers.get("Authorization", "")
    if auth.startswith("Basic "):
        try:
            decoded = base64.b64decode(auth[6:]).decode("utf-8")
            user, password = decoded.split(":", 1)

            # Multi-user mode
            if config.users:
                uinfo = config.users.get(user)
                if uinfo and uinfo.get("password") == password:
                    handler._dashboard_user = user
                    return user

            # Single-user fallback
            elif user == config.AUTH_USER and password == config.AUTH_PASS:
                handler._dashboard_user = "admin"
                return "admin"
        except Exception:
            pass

    handler.send_response(401)
    handler.send_header("WWW-Authenticate", 'Basic realm="DevPod Dashboard"')
    handler.send_header("Content-Type", "text/plain")
    handler.end_headers()
    handler.wfile.write(b"Unauthorized")
    return ""
