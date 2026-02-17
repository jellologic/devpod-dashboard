"""Kubernetes helpers - kubectl wrappers."""

import json
import subprocess

from . import config


def kubectl(args, input_data=None):
    cmd = ["kubectl", "--kubeconfig", config.KUBECONFIG, "-n", config.NAMESPACE] + args
    return subprocess.run(cmd, capture_output=True, text=True, timeout=15, input=input_data)


def kubectl_json(args):
    result = kubectl(args + ["-o", "json"])
    if result.returncode != 0:
        return None
    return json.loads(result.stdout)


def kubectl_stream_logs(pod_name, tail=200):
    """Return a Popen streaming kubectl logs --follow for SSE."""
    cmd = [
        "kubectl", "--kubeconfig", config.KUBECONFIG, "-n", config.NAMESPACE,
        "logs", pod_name, "--follow", f"--tail={tail}",
    ]
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
