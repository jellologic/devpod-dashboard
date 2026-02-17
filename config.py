"""Constants, env vars, and shared mutable state.

All configuration is read from environment variables with sensible defaults.
See .env.example for the full list.
"""

import json
import os
import threading
from collections import deque

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

# Multi-user auth (Feature 4)
USERS_FILE = os.environ.get("DASHBOARD_USERS_FILE", "")
users = {}  # username -> {"password": str, "role": str, "prefixes": list}

# Mutable shared state
# creating_workspaces[name] = {"status": str, "started": float, "log_buffer": LogBuffer|None}
creating_workspaces = {}
creating_lock = threading.Lock()

sys_stats = {}
stats_lock = threading.Lock()
prev_cpu = None

# Usage history (Feature 3): pod_name -> deque(maxlen=720) of (timestamp, cpu_mc, mem_bytes)
# 720 entries * 2min interval = 24h retention
ws_usage_history = {}
ws_usage_lock = threading.Lock()


def load_users():
    """Load users from JSON file. Called at startup and on reload."""
    global users
    if not USERS_FILE:
        users = {}
        return
    try:
        with open(USERS_FILE) as f:
            users = json.load(f)
    except FileNotFoundError:
        users = {}
    except Exception:
        users = {}
