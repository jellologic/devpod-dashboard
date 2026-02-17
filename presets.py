"""CRUD for workspace templates stored in ConfigMap."""

import json
import uuid

from .kube import kubectl, kubectl_json
from . import config
from .workspaces import create_workspace

CONFIGMAP_NAME = "devpod-dashboard-templates"


def _get_configmap():
    """Fetch the templates ConfigMap, return (cm_dict, templates_list)."""
    cm = kubectl_json(["get", "configmap", CONFIGMAP_NAME])
    if not cm:
        return None, []
    try:
        templates = json.loads(cm.get("data", {}).get("templates", "[]"))
    except (json.JSONDecodeError, TypeError):
        templates = []
    return cm, templates


def _save_templates(templates):
    """Write templates list back to the ConfigMap."""
    cm = {
        "apiVersion": "v1", "kind": "ConfigMap",
        "metadata": {"name": CONFIGMAP_NAME, "namespace": config.NAMESPACE},
        "data": {"templates": json.dumps(templates)},
    }
    r = kubectl(["apply", "-f", "-"], input_data=json.dumps(cm))
    return r.returncode == 0, r.stderr.strip() if r.returncode != 0 else ""


def get_presets():
    """Return list of preset dicts."""
    _, templates = _get_configmap()
    return templates


def save_preset(name, description, repo_url, req_cpu, req_mem, lim_cpu, lim_mem):
    """Save a new workspace template. Returns (ok, msg)."""
    if not name or not repo_url:
        return False, "Name and repo URL are required"
    _, templates = _get_configmap()
    preset = {
        "id": uuid.uuid4().hex[:8],
        "name": name,
        "description": description,
        "repo_url": repo_url,
        "req_cpu": req_cpu,
        "req_mem": req_mem,
        "lim_cpu": lim_cpu,
        "lim_mem": lim_mem,
    }
    templates.append(preset)
    ok, err = _save_templates(templates)
    if not ok:
        return False, f"Failed to save: {err}"
    return True, f"Template '{name}' saved"


def delete_preset(preset_id):
    """Delete a preset by ID. Returns (ok, msg)."""
    _, templates = _get_configmap()
    templates = [t for t in templates if t.get("id") != preset_id]
    ok, err = _save_templates(templates)
    if not ok:
        return False, f"Failed to delete: {err}"
    return True, "Template deleted"


def create_from_preset(preset_id, ws_name=""):
    """Create a workspace from a preset template. Returns (ok, msg)."""
    _, templates = _get_configmap()
    preset = None
    for t in templates:
        if t.get("id") == preset_id:
            preset = t
            break
    if not preset:
        return False, "Template not found"
    return create_workspace(preset["repo_url"], ws_name)
