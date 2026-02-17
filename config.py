"""Constants, env vars, and shared mutable state.

All configuration is read from environment variables with sensible defaults.
See .env.example for the full list.
"""

import os
import threading

# Server
LISTEN_PORT = int(os.environ.get("DASHBOARD_PORT", "8080"))
AUTH_USER = os.environ.get("DASHBOARD_USER", "admin")
AUTH_PASS = os.environ.get("DASHBOARD_PASS", "changeme")

# Kubernetes
NAMESPACE = os.environ.get("DASHBOARD_NAMESPACE", "devpod")
KUBECONFIG = os.environ.get("KUBECONFIG", "/etc/rancher/k3s/k3s.yaml")

# DevPod system user (used for sudo -u when running devpod CLI)
DEVPOD_USER = os.environ.get("DEVPOD_USER", "devpod")
DEVPOD_HOME = os.environ.get("DEVPOD_HOME", f"/home/{DEVPOD_USER}")

# Mutable shared state
# creating_workspaces[name] = {"status": str, "started": float, "log_buffer": LogBuffer|None}
creating_workspaces = {}
creating_lock = threading.Lock()

sys_stats = {}
stats_lock = threading.Lock()
prev_cpu = None
