"""Provider defaults, LimitRange, and ResourceQuota management."""

import json
import os
import re
import subprocess

from . import config
from .kube import kubectl, kubectl_json


def _devpod_env():
    """Environment dict for running devpod CLI as the configured user."""
    return {**os.environ, "HOME": config.DEVPOD_HOME, "USER": config.DEVPOD_USER}


def get_settings():
    """Read current cluster resource settings."""
    settings = {"provider": {}, "limitrange": {}, "quota": {}}

    # Provider defaults from devpod config
    try:
        r = subprocess.run(
            ["sudo", "-u", config.DEVPOD_USER, "devpod", "provider", "options", "kubernetes"],
            capture_output=True, text=True, timeout=10, env=_devpod_env())
        for line in r.stdout.split("\n"):
            if "RESOURCES" in line and "requests" in line:
                m = re.search(r'requests\.cpu=([^,]+),requests\.memory=([^,]+),'
                              r'limits\.cpu=([^,]+),limits\.memory=([^\s|]+)', line)
                if m:
                    settings["provider"] = {
                        "req_cpu": m.group(1), "req_mem": m.group(2),
                        "lim_cpu": m.group(3), "lim_mem": m.group(4),
                    }
    except Exception:
        pass

    # LimitRange
    lr = kubectl_json(["get", "limitrange", "devpod-limits"])
    if lr:
        for lim in lr.get("spec", {}).get("limits", []):
            if lim.get("type") == "Container":
                d = lim.get("default", {})
                dr = lim.get("defaultRequest", {})
                mx = lim.get("max", {})
                settings["limitrange"] = {
                    "max_cpu": mx.get("cpu", ""), "max_mem": mx.get("memory", ""),
                    "def_cpu": d.get("cpu", ""), "def_mem": d.get("memory", ""),
                    "def_req_cpu": dr.get("cpu", ""), "def_req_mem": dr.get("memory", ""),
                }

    # ResourceQuota
    rq = kubectl_json(["get", "resourcequota", "devpod-quota"])
    if rq:
        hard = rq.get("spec", {}).get("hard", {})
        used = rq.get("status", {}).get("used", {})
        settings["quota"] = {
            "req_cpu": hard.get("requests.cpu", ""),
            "req_mem": hard.get("requests.memory", ""),
            "pods": hard.get("pods", ""),
            "used_req_cpu": used.get("requests.cpu", ""),
            "used_req_mem": used.get("requests.memory", ""),
            "used_pods": used.get("pods", ""),
        }

    return settings


def save_provider_defaults(req_cpu, req_mem, lim_cpu, lim_mem):
    res = f"requests.cpu={req_cpu},requests.memory={req_mem},limits.cpu={lim_cpu},limits.memory={lim_mem}"
    r = subprocess.run(
        ["sudo", "-u", config.DEVPOD_USER, "devpod", "provider", "set-options", "kubernetes",
         "-o", f"RESOURCES={res}"],
        capture_output=True, text=True, timeout=10, env=_devpod_env())
    if r.returncode != 0:
        return False, f"Failed: {r.stderr}"
    return True, f"Provider defaults updated: {res}"


def save_limitrange(max_cpu, max_mem, def_req_cpu, def_req_mem):
    lr = {
        "apiVersion": "v1", "kind": "LimitRange",
        "metadata": {"name": "devpod-limits", "namespace": config.NAMESPACE},
        "spec": {"limits": [{
            "type": "Container",
            "default": {"cpu": max_cpu, "memory": max_mem},
            "defaultRequest": {"cpu": def_req_cpu, "memory": def_req_mem},
            "max": {"cpu": max_cpu, "memory": max_mem},
        }]},
    }
    r = kubectl(["apply", "-f", "-"], input_data=json.dumps(lr))
    if r.returncode != 0:
        return False, f"Failed: {r.stderr}"
    return True, f"LimitRange updated: max {max_cpu}/{max_mem}"


def save_quota(req_cpu, req_mem, pods):
    rq = {
        "apiVersion": "v1", "kind": "ResourceQuota",
        "metadata": {"name": "devpod-quota", "namespace": config.NAMESPACE},
        "spec": {"hard": {"requests.cpu": str(req_cpu), "requests.memory": str(req_mem),
                           "pods": str(pods)}},
    }
    r = kubectl(["apply", "-f", "-"], input_data=json.dumps(rq))
    if r.returncode != 0:
        return False, f"Failed: {r.stderr}"
    return True, f"ResourceQuota updated: {req_cpu} CPU, {req_mem} mem, {pods} pods"
