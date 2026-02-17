"""Log management - LogBuffer ring buffer and streaming helpers."""

import threading

from . import config
from .kube import kubectl_stream_logs


class LogBuffer:
    """Thread-safe ring buffer for log lines."""

    def __init__(self, max_lines=2000):
        self._lines = []
        self._max = max_lines
        self._lock = threading.Lock()

    def append(self, line):
        with self._lock:
            self._lines.append(line)
            if len(self._lines) > self._max:
                self._lines = self._lines[-self._max:]

    def get_all(self):
        with self._lock:
            return list(self._lines)


def get_creation_log(ws_name):
    """Retrieve creation log for a workspace being created."""
    with config.creating_lock:
        cinfo = config.creating_workspaces.get(ws_name)
        if not cinfo:
            return None, None
        buf = cinfo.get("log_buffer")
        status = cinfo.get("status", "Unknown")
    if buf:
        return buf.get_all(), status
    return [], status


def stream_pod_logs(pod_name):
    """Generator yielding log lines from kubectl logs --follow."""
    proc = kubectl_stream_logs(pod_name)
    try:
        for line in proc.stdout:
            yield line.rstrip("\n")
    except Exception:
        pass
    finally:
        proc.kill()
        proc.wait()
