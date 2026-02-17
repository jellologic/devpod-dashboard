"""Schedule CRUD + background executor + workspace expiry, stored in ConfigMap."""

import json
import threading
import time
from datetime import datetime, timezone

from .kube import kubectl, kubectl_json
from . import config
from .workspaces import get_workspaces, stop_workspace, start_workspace, delete_workspace

CONFIGMAP_NAME = "devpod-dashboard-schedules"
EXPIRY_CONFIGMAP_NAME = "devpod-dashboard-expiry"

# Track last-fired times to deduplicate within same minute
_last_fired = {}
_lock = threading.Lock()


def _get_configmap():
    """Fetch schedules ConfigMap, return (cm_dict, schedules_list)."""
    cm = kubectl_json(["get", "configmap", CONFIGMAP_NAME])
    if not cm:
        return None, []
    try:
        schedules = json.loads(cm.get("data", {}).get("schedules", "[]"))
    except (json.JSONDecodeError, TypeError):
        schedules = []
    return cm, schedules


def _save_schedules(schedules):
    """Write schedules list back to ConfigMap."""
    cm = {
        "apiVersion": "v1", "kind": "ConfigMap",
        "metadata": {"name": CONFIGMAP_NAME, "namespace": config.NAMESPACE},
        "data": {"schedules": json.dumps(schedules)},
    }
    r = kubectl(["apply", "-f", "-"], input_data=json.dumps(cm))
    return r.returncode == 0, r.stderr.strip() if r.returncode != 0 else ""


def get_schedules():
    """Return list of all schedule dicts."""
    _, schedules = _get_configmap()
    return schedules


def get_schedules_for_workspace(ws_name):
    """Return schedules for a specific workspace."""
    _, schedules = _get_configmap()
    return [s for s in schedules if s.get("workspace") == ws_name]


def has_schedule(ws_name):
    """Check if a workspace has any schedules."""
    _, schedules = _get_configmap()
    return any(s.get("workspace") == ws_name for s in schedules)


def set_schedule(ws_name, pod_name, action, days, hour, minute):
    """Set a schedule for a workspace. Keyed by (workspace, action).
    days is a list of day abbreviations like ['Mon','Tue','Wed'].
    Returns (ok, msg).
    """
    if action not in ("start", "stop"):
        return False, "Action must be 'start' or 'stop'"
    if not days:
        return False, "Select at least one day"

    _, schedules = _get_configmap()
    # Remove existing schedule for this workspace+action
    schedules = [s for s in schedules
                 if not (s.get("workspace") == ws_name and s.get("action") == action)]
    schedules.append({
        "workspace": ws_name,
        "pod_name": pod_name,
        "action": action,
        "days": days,
        "hour": int(hour),
        "minute": int(minute),
    })
    ok, err = _save_schedules(schedules)
    if not ok:
        return False, f"Failed to save: {err}"
    return True, f"Schedule set: {action} on {','.join(days)} at {int(hour):02d}:{int(minute):02d} UTC"


def remove_schedule(ws_name, action):
    """Remove a schedule. Returns (ok, msg)."""
    _, schedules = _get_configmap()
    before = len(schedules)
    schedules = [s for s in schedules
                 if not (s.get("workspace") == ws_name and s.get("action") == action)]
    if len(schedules) == before:
        return True, "No schedule found"
    ok, err = _save_schedules(schedules)
    if not ok:
        return False, f"Failed to remove: {err}"
    return True, f"Schedule removed: {action} for {ws_name}"


# --- Expiry ---

def get_expiry_days():
    """Read expiry days from ConfigMap. Returns int (0 = disabled)."""
    cm = kubectl_json(["get", "configmap", EXPIRY_CONFIGMAP_NAME])
    if not cm:
        return 0
    try:
        return int(cm.get("data", {}).get("days", "0"))
    except (ValueError, TypeError):
        return 0


def set_expiry_days(days):
    """Save expiry days to ConfigMap. Returns (ok, msg)."""
    try:
        days = int(days)
    except (ValueError, TypeError):
        return False, "Invalid value"
    cm = {
        "apiVersion": "v1", "kind": "ConfigMap",
        "metadata": {"name": EXPIRY_CONFIGMAP_NAME, "namespace": config.NAMESPACE},
        "data": {"days": str(days)},
    }
    r = kubectl(["apply", "-f", "-"], input_data=json.dumps(cm))
    if r.returncode != 0:
        return False, f"Failed: {r.stderr.strip()}"
    return True, f"Expiry set to {days} days" if days > 0 else "Expiry disabled"


def _check_expiry():
    """Check workspace expiry and delete/warn as needed."""
    expiry_days = get_expiry_days()
    if expiry_days <= 0:
        return

    now = datetime.now(timezone.utc)
    try:
        workspaces = get_workspaces()
    except Exception:
        return

    for w in workspaces:
        if w.get("creating"):
            continue
        pod_name = w.get("pod", "")
        if not pod_name:
            continue

        # Determine last activity time
        last = w.get("last_accessed", "")
        if not last:
            # Fall back to pod creation timestamp (get from pod)
            try:
                pod = kubectl_json(["get", "pod", pod_name])
                if pod:
                    last = pod["metadata"].get("creationTimestamp", "")
            except Exception:
                continue
        if not last:
            continue

        try:
            last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
        except Exception:
            continue

        idle_days = (now - last_dt).total_seconds() / 86400

        # Delete if idle > expiry_days
        if idle_days > expiry_days:
            try:
                delete_workspace(w["name"], pod_name, w.get("uid", ""))
            except Exception:
                pass
            continue

        # Warn if idle > (expiry_days - 1) and no warning set
        if idle_days > (expiry_days - 1) and not w.get("expiry_warning"):
            try:
                kubectl(["annotate", "pod", pod_name,
                         f"devpod-dashboard/expiry-warning={now.isoformat()}",
                         "--overwrite"])
            except Exception:
                pass


# --- Scheduler loop ---

def scheduler_loop():
    """Background loop checking schedules every 60 seconds."""
    time.sleep(10)  # Initial delay to let server start
    while True:
        try:
            _check_schedules()
        except Exception:
            pass
        try:
            _check_expiry()
        except Exception:
            pass
        time.sleep(60)


def _check_schedules():
    """Check all schedules and fire any that match current time."""
    now = datetime.now(timezone.utc)
    day_name = now.strftime("%a")  # Mon, Tue, etc.
    hour = now.hour
    minute = now.minute

    _, schedules = _get_configmap()
    if not schedules:
        return

    for sched in schedules:
        if day_name not in sched.get("days", []):
            continue
        if sched.get("hour") != hour or sched.get("minute") != minute:
            continue

        key = (sched["workspace"], sched["action"])
        fire_key = f"{key[0]}:{key[1]}:{day_name}:{hour}:{minute}"

        with _lock:
            if fire_key in _last_fired:
                continue
            _last_fired[fire_key] = time.time()

        # Resolve current pod name from live workspace list
        ws_name = sched["workspace"]
        try:
            workspaces = get_workspaces()
            pod_name = ""
            for w in workspaces:
                if w["name"] == ws_name:
                    pod_name = w.get("pod", "")
                    break

            if sched["action"] == "stop" and pod_name:
                stop_workspace(pod_name)
            elif sched["action"] == "start" and pod_name:
                start_workspace(pod_name)
        except Exception:
            pass

    # Clean old entries from _last_fired (older than 2 minutes)
    cutoff = time.time() - 120
    with _lock:
        stale = [k for k, v in _last_fired.items() if v < cutoff]
        for k in stale:
            del _last_fired[k]
