"""HTTP server, route dispatch, and main() entry point."""

import http.server
import json
import re
import threading
import time

from . import config
from .auth import check_auth
from .settings import (get_settings, save_provider_defaults, save_limitrange, save_quota)
from .workspaces import (get_workspaces, get_workspace_detail,
                         stop_workspace, start_workspace, set_timer,
                         create_workspace, delete_workspace,
                         duplicate_workspace, resize_workspace)
from .logs import get_creation_log, stream_pod_logs
from .stats import collect_stats_loop
from .templates import render_main_page, render_workspace_detail_page


class DashboardHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if not check_auth(self):
            return

        path = self.path.split("?")[0]  # strip query string

        # GET / - main dashboard
        if path == "/":
            workspaces = get_workspaces()
            settings = get_settings()
            html = render_main_page(workspaces, settings)
            self._send_html(html)

        # GET /workspace/<name> - workspace detail page
        elif path.startswith("/workspace/"):
            ws_name = path[len("/workspace/"):]
            ws_name = _url_decode(ws_name)
            if not ws_name:
                self._send_json({"error": "Missing workspace name"}, 400)
                return
            detail = get_workspace_detail(ws_name)
            html = render_workspace_detail_page(detail)
            self._send_html(html)

        # GET /api/logs/stream/<pod_name> - SSE endpoint for live pod logs
        elif path.startswith("/api/logs/stream/"):
            pod_name = path[len("/api/logs/stream/"):]
            pod_name = _url_decode(pod_name)
            if not pod_name:
                self._send_json({"error": "Missing pod name"}, 400)
                return
            self._stream_sse_logs(pod_name)

        # GET /api/logs/creation/<ws_name> - JSON endpoint for creation logs
        elif path.startswith("/api/logs/creation/"):
            ws_name = path[len("/api/logs/creation/"):]
            ws_name = _url_decode(ws_name)
            lines, status = get_creation_log(ws_name)
            if lines is None:
                self._send_json({"lines": [], "status": None, "creating": False})
            else:
                self._send_json({"lines": lines, "status": status, "creating": True})

        else:
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Not Found")

    def do_POST(self):
        if not check_auth(self):
            return
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        path = self.path

        if path == "/api/stop":
            ok, msg = stop_workspace(body.get("pod", ""))
        elif path == "/api/start":
            ok, msg = start_workspace(body.get("pod", ""))
        elif path == "/api/timer":
            ok, msg = set_timer(body.get("pod", ""), body.get("hours", 0))
        elif path == "/api/create":
            ok, msg = create_workspace(body.get("repo", ""), body.get("name", ""))
        elif path == "/api/delete":
            ok, msg = delete_workspace(body.get("name", ""), body.get("pod", ""), body.get("uid", ""))
        elif path == "/api/duplicate":
            ok, msg = duplicate_workspace(body.get("pod", ""), body.get("name", ""),
                                           body.get("new_name", ""), body.get("repo", ""))
        elif path == "/api/resize":
            ok, msg = resize_workspace(body.get("pod", ""), body.get("uid", ""),
                                        body.get("req_cpu", "4"), body.get("req_mem", "8Gi"),
                                        body.get("lim_cpu", "24"), body.get("lim_mem", "64Gi"))
        elif path == "/api/settings/provider":
            ok, msg = save_provider_defaults(body.get("req_cpu", "4"), body.get("req_mem", "8Gi"),
                                              body.get("lim_cpu", "24"), body.get("lim_mem", "64Gi"))
        elif path == "/api/settings/limitrange":
            ok, msg = save_limitrange(body.get("max_cpu", "24"), body.get("max_mem", "64Gi"),
                                       body.get("def_req_cpu", "4"), body.get("def_req_mem", "8Gi"))
        elif path == "/api/settings/quota":
            ok, msg = save_quota(body.get("req_cpu", "72"), body.get("req_mem", "192Gi"),
                                  body.get("pods", "20"))
        else:
            ok, msg = False, "Unknown endpoint"

        self._send_json({"ok": ok, "message": msg})

    def _send_html(self, html):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode())

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _stream_sse_logs(self, pod_name):
        """Stream logs as Server-Sent Events."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            for line in stream_pod_logs(pod_name):
                self.wfile.write(f"data: {line}\n\n".encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, fmt, *args):
        pass


def _url_decode(s):
    """Simple percent-decode for URL path segments."""
    try:
        from urllib.parse import unquote
        return unquote(s)
    except Exception:
        return s


def main():
    threading.Thread(target=collect_stats_loop, daemon=True).start()
    time.sleep(2.5)
    port = config.LISTEN_PORT
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), DashboardHandler)
    print(f"DevPod Dashboard on http://0.0.0.0:{port}")
    server.serve_forever()
