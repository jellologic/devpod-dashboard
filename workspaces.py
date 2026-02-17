"""Workspace CRUD operations and detail gathering."""

import json
import os
import subprocess
import threading
import time
from datetime import datetime, timezone, timedelta

from . import config
from .kube import kubectl, kubectl_json


def _devpod_env():
    """Environment dict for running devpod CLI as the configured user."""
    return {
        **os.environ,
        "HOME": config.DEVPOD_HOME,
        "USER": config.DEVPOD_USER,
        "KUBECONFIG": os.path.join(config.DEVPOD_HOME, ".kube", "config"),
    }


def get_git_repo_for_pod(pod_name, workspace_name):
    """Get git remote URL from inside a running pod."""
    try:
        r = kubectl(["exec", pod_name, "--",
                      "cat", f"/workspaces/{workspace_name}/.git/config"])
        if r.returncode == 0:
            for line in r.stdout.split("\n"):
                line = line.strip()
                if line.startswith("url = "):
                    return line[6:].strip()
    except Exception:
        pass
    return ""


def get_workspaces():
    pods = kubectl_json(["get", "pods", "-l", "devpod.sh/created=true"])
    svcs = kubectl_json(["get", "svc", "-l", "managed-by=devpod-nodeport-controller"])
    if not pods:
        pods = {"items": []}
    if not svcs:
        svcs = {"items": []}

    svc_map = {}
    for svc in svcs.get("items", []):
        uid = svc["spec"]["selector"].get("devpod.sh/workspace-uid", "")
        port = svc["spec"]["ports"][0].get("nodePort", 0)
        svc_map[uid] = port

    # Fetch usage for all pods at once (best-effort)
    usage_map = {}
    try:
        r = kubectl(["top", "pods", "--no-headers"])
        if r.returncode == 0:
            for line in r.stdout.strip().split("\n"):
                parts = line.split()
                if len(parts) >= 3:
                    usage_map[parts[0]] = {"cpu": parts[1], "memory": parts[2]}
    except Exception:
        pass

    workspaces = []
    running_names = set()
    for pod in pods.get("items", []):
        uid = pod["metadata"]["labels"].get("devpod.sh/workspace-uid", "")
        name = pod["metadata"]["name"]
        status = pod["status"]["phase"]
        workspace_name = ""
        for container in pod["spec"].get("containers", []):
            for vm in container.get("volumeMounts", []):
                mp = vm.get("mountPath", "")
                if mp.startswith("/workspaces/") and mp != "/workspaces/.dockerless":
                    workspace_name = mp.split("/")[-1]
                    break
        annotations = pod["metadata"].get("annotations", {})
        res = {}
        if pod["spec"].get("containers"):
            c_res = pod["spec"]["containers"][0].get("resources", {})
            res = {
                "req_cpu": c_res.get("requests", {}).get("cpu", ""),
                "req_mem": c_res.get("requests", {}).get("memory", ""),
                "lim_cpu": c_res.get("limits", {}).get("cpu", ""),
                "lim_mem": c_res.get("limits", {}).get("memory", ""),
            }
        ws_display = workspace_name or name
        repo = get_git_repo_for_pod(name, ws_display) if status == "Running" else ""
        running_names.add(ws_display)
        workspaces.append({
            "name": ws_display, "status": status, "port": svc_map.get(uid, 0),
            "pod": name, "uid": uid, "running": True, "creating": False,
            "shutdown_at": annotations.get("devpod.sh/auto-shutdown-at", ""),
            "shutdown_hours": annotations.get("devpod.sh/auto-shutdown-hours", ""),
            "resources": res, "repo": repo,
            "usage": usage_map.get(name, {}),
        })

    cms = kubectl_json(["get", "configmap", "-l", "managed-by=devpod-dashboard"])
    if cms:
        running_uids = {w["uid"] for w in workspaces}
        for cm in cms.get("items", []):
            uid = cm["metadata"]["labels"].get("workspace-uid", "")
            if uid not in running_uids:
                data = json.loads(cm["data"].get("spec", "{}"))
                ws_name = cm["metadata"]["labels"].get("workspace-name", uid)
                res = {}
                containers = data.get("spec", {}).get("containers", [])
                if containers:
                    c_res = containers[0].get("resources", {})
                    res = {
                        "req_cpu": c_res.get("requests", {}).get("cpu", ""),
                        "req_mem": c_res.get("requests", {}).get("memory", ""),
                        "lim_cpu": c_res.get("limits", {}).get("cpu", ""),
                        "lim_mem": c_res.get("limits", {}).get("memory", ""),
                    }
                workspaces.append({
                    "name": ws_name, "status": "Stopped", "port": 0,
                    "pod": data.get("metadata", {}).get("name", ""), "uid": uid,
                    "running": False, "creating": False,
                    "shutdown_at": "", "shutdown_hours": "", "resources": res,
                    "repo": "",
                })

    with config.creating_lock:
        for cname, cinfo in list(config.creating_workspaces.items()):
            if time.time() - cinfo["started"] > 600:
                del config.creating_workspaces[cname]
                continue
            if cname not in running_names:
                workspaces.append({
                    "name": cname, "status": cinfo["status"], "port": 0,
                    "pod": "", "uid": "", "running": False, "creating": True,
                    "shutdown_at": "", "shutdown_hours": "", "resources": {},
                    "repo": "",
                })

    workspaces.sort(key=lambda w: (not w["running"] and not w["creating"],
                                    not w["creating"], w["name"]))
    return workspaces


def stop_workspace(pod_name):
    pod = kubectl_json(["get", "pod", pod_name])
    if not pod:
        return False, "Pod not found"
    uid = pod["metadata"]["labels"].get("devpod.sh/workspace-uid", "")
    workspace_name = ""
    for container in pod["spec"].get("containers", []):
        for vm in container.get("volumeMounts", []):
            mp = vm.get("mountPath", "")
            if mp.startswith("/workspaces/") and mp != "/workspaces/.dockerless":
                workspace_name = mp.split("/")[-1]
                break
    clean_pod = {
        "apiVersion": "v1", "kind": "Pod",
        "metadata": {
            "name": pod["metadata"]["name"], "namespace": config.NAMESPACE,
            "labels": pod["metadata"]["labels"],
            "annotations": {k: v for k, v in pod["metadata"].get("annotations", {}).items()
                           if k != "kubernetes.io/limit-ranger"},
        },
        "spec": pod["spec"],
    }
    for key in ("nodeName", "serviceAccount", "serviceAccountName",
                "tolerations", "priority", "enableServiceLinks", "preemptionPolicy"):
        clean_pod["spec"].pop(key, None)
    for clist in ("containers", "initContainers"):
        for c in clean_pod["spec"].get(clist, []):
            c.pop("terminationMessagePath", None)
            c.pop("terminationMessagePolicy", None)

    cm = {
        "apiVersion": "v1", "kind": "ConfigMap",
        "metadata": {
            "name": f"saved-{uid}", "namespace": config.NAMESPACE,
            "labels": {"managed-by": "devpod-dashboard", "workspace-uid": uid,
                       "workspace-name": workspace_name or pod_name},
        },
        "data": {"spec": json.dumps(clean_pod)},
    }
    r = kubectl(["apply", "-f", "-"], input_data=json.dumps(cm))
    if r.returncode != 0:
        return False, f"Failed to save spec: {r.stderr}"
    r = kubectl(["delete", "pod", pod_name, "--grace-period=30"])
    if r.returncode != 0:
        return False, f"Failed to delete pod: {r.stderr}"
    return True, "Workspace stopped"


def start_workspace(pod_name):
    cms = kubectl_json(["get", "configmap", "-l", "managed-by=devpod-dashboard"])
    if not cms:
        return False, "No saved state found"
    for cm in cms.get("items", []):
        data = json.loads(cm["data"].get("spec", "{}"))
        if data.get("metadata", {}).get("name") == pod_name:
            r = kubectl(["apply", "-f", "-"], input_data=cm["data"]["spec"])
            if r.returncode != 0:
                return False, f"Failed to create pod: {r.stderr}"
            return True, "Workspace starting"
    return False, f"No saved spec for {pod_name}"


def set_timer(pod_name, hours):
    if hours <= 0:
        r = kubectl(["annotate", "pod", pod_name,
                      "devpod.sh/auto-shutdown-at-", "devpod.sh/auto-shutdown-hours-"])
        msg = "Timer removed"
    else:
        sa = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
        r = kubectl(["annotate", "pod", pod_name,
                      f"devpod.sh/auto-shutdown-at={sa}",
                      f"devpod.sh/auto-shutdown-hours={hours}", "--overwrite"])
        msg = f"Auto-shutdown in {hours}h"
    if r.returncode != 0:
        return False, f"Failed: {r.stderr}"
    return True, msg


def resize_workspace(pod_name, uid, req_cpu, req_mem, lim_cpu, lim_mem):
    """Resize a workspace: update resources in saved spec (and stop if running)."""
    pod = kubectl_json(["get", "pod", pod_name])
    if pod:
        ok, msg = stop_workspace(pod_name)
        if not ok:
            return False, f"Failed to stop for resize: {msg}"
        time.sleep(1)

    cms = kubectl_json(["get", "configmap", "-l", "managed-by=devpod-dashboard"])
    if not cms:
        return False, "No saved state found - stop the workspace first"

    for cm in cms.get("items", []):
        spec = json.loads(cm["data"].get("spec", "{}"))
        if spec.get("metadata", {}).get("name") == pod_name:
            for container in spec.get("spec", {}).get("containers", []):
                container["resources"] = {
                    "requests": {"cpu": req_cpu, "memory": req_mem},
                    "limits": {"cpu": lim_cpu, "memory": lim_mem},
                }
            cm["data"]["spec"] = json.dumps(spec)
            r = kubectl(["apply", "-f", "-"], input_data=json.dumps(cm))
            if r.returncode != 0:
                return False, f"Failed to update spec: {r.stderr}"
            r = kubectl(["apply", "-f", "-"], input_data=json.dumps(spec))
            if r.returncode != 0:
                return False, f"Failed to restart: {r.stderr}"
            return True, f"Resized to {lim_cpu}/{lim_mem} and restarting"

    return False, f"No saved spec for {pod_name}"


def delete_workspace(ws_name, pod_name, uid):
    errors = []
    if pod_name:
        r = kubectl(["delete", "pod", pod_name, "--grace-period=10", "--ignore-not-found"])
        if r.returncode != 0:
            errors.append(f"pod: {r.stderr.strip()}")
    if uid:
        kubectl(["delete", "configmap", f"saved-{uid}", "--ignore-not-found"])
    pvcs = kubectl_json(["get", "pvc", "-l", f"devpod.sh/workspace-uid={uid}"]) if uid else None
    if pvcs:
        for pvc in pvcs.get("items", []):
            pvc_name = pvc["metadata"]["name"]
            r = kubectl(["delete", "pvc", pvc_name])
            if r.returncode != 0:
                errors.append(f"pvc {pvc_name}: {r.stderr.strip()}")
    all_pvcs = kubectl_json(["get", "pvc"])
    if all_pvcs:
        for pvc in all_pvcs.get("items", []):
            pvc_name = pvc["metadata"]["name"]
            if pod_name and pod_name in pvc_name:
                kubectl(["delete", "pvc", pvc_name, "--ignore-not-found"])
    if uid:
        kubectl(["delete", "svc", f"vscode-{uid}", "--ignore-not-found"])
    if ws_name:
        env = _devpod_env()
        try:
            subprocess.run(["sudo", "-u", config.DEVPOD_USER, "-E", "devpod",
                            "delete", ws_name, "--force"],
                           capture_output=True, text=True, timeout=30, env=env)
        except Exception:
            pass
    if errors:
        return True, f"Deleted with warnings: {'; '.join(errors)}"
    return True, f"Workspace '{ws_name}' deleted"


def duplicate_workspace(source_pod, source_name, new_name, repo):
    """Duplicate a workspace: create new workspace from same repo, then copy PVC data."""
    from .logs import LogBuffer

    if not new_name:
        new_name = f"{source_name}-copy"
    if not repo:
        return False, "Cannot duplicate: source repo unknown"

    pvcs = kubectl_json(["get", "pvc"])
    source_pvc = None
    if pvcs:
        for pvc in pvcs.get("items", []):
            if source_pod and source_pod in pvc["metadata"]["name"]:
                source_pvc = pvc["metadata"]["name"]
                break

    log_buf = LogBuffer()
    with config.creating_lock:
        if new_name in config.creating_workspaces:
            return False, f"Workspace '{new_name}' is already being created"
        config.creating_workspaces[new_name] = {
            "status": "Duplicating", "started": time.time(), "log_buffer": log_buf,
        }

    def _run():
        try:
            env = _devpod_env()
            proc = subprocess.Popen(
                ["sudo", "-u", config.DEVPOD_USER, "-E", "devpod", "up", repo,
                 "--ide", "openvscode", "--provider", "kubernetes", "--id", new_name],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
            for line in proc.stdout:
                log_buf.append(line.rstrip("\n"))
            proc.wait(timeout=600)

            if proc.returncode != 0:
                with config.creating_lock:
                    config.creating_workspaces[new_name] = {
                        "status": f"Failed (rc={proc.returncode})",
                        "started": time.time(), "log_buffer": log_buf,
                    }
                return

            if source_pvc:
                with config.creating_lock:
                    config.creating_workspaces[new_name] = {
                        "status": "Copying data...", "started": time.time(),
                        "log_buffer": log_buf,
                    }
                log_buf.append("--- Copying data from source PVC ---")

                time.sleep(5)
                new_pvcs = kubectl_json(["get", "pvc"])
                dest_pvc = None
                if new_pvcs:
                    for pvc in new_pvcs.get("items", []):
                        pn = pvc["metadata"]["name"]
                        if new_name.replace("-", "") in pn.replace("-", "") and pn != source_pvc:
                            dest_pvc = pn
                            break

                if dest_pvc:
                    new_pods = kubectl_json(["get", "pods", "-l", "devpod.sh/created=true"])
                    new_pod_name = None
                    if new_pods:
                        for pod in new_pods.get("items", []):
                            for c in pod["spec"].get("containers", []):
                                for vm in c.get("volumeMounts", []):
                                    if vm.get("mountPath", "").endswith(f"/{new_name}"):
                                        new_pod_name = pod["metadata"]["name"]
                                        break

                    copy_job = {
                        "apiVersion": "batch/v1", "kind": "Job",
                        "metadata": {"name": f"copy-{new_name[:40]}", "namespace": config.NAMESPACE},
                        "spec": {
                            "ttlSecondsAfterFinished": 60,
                            "template": {"spec": {
                                "restartPolicy": "Never",
                                "containers": [{
                                    "name": "copy",
                                    "image": "alpine",
                                    "command": ["sh", "-c",
                                                "apk add --no-cache rsync && "
                                                "rsync -a --delete /src/ /dst/"],
                                    "volumeMounts": [
                                        {"name": "src", "mountPath": "/src"},
                                        {"name": "dst", "mountPath": "/dst"},
                                    ],
                                }],
                                "volumes": [
                                    {"name": "src", "persistentVolumeClaim": {"claimName": source_pvc}},
                                    {"name": "dst", "persistentVolumeClaim": {"claimName": dest_pvc}},
                                ],
                            }},
                        },
                    }
                    if new_pod_name:
                        kubectl(["delete", "pod", new_pod_name, "--grace-period=5"])
                        time.sleep(3)

                    kubectl(["apply", "-f", "-"], input_data=json.dumps(copy_job))
                    log_buf.append(f"Copy job started: {source_pvc} -> {dest_pvc}")

                    for _ in range(120):
                        time.sleep(5)
                        job = kubectl_json(["get", "job", f"copy-{new_name[:40]}"])
                        if job:
                            conds = job.get("status", {}).get("conditions", [])
                            for cond in conds:
                                if cond.get("type") == "Complete" and cond.get("status") == "True":
                                    log_buf.append("Copy job completed successfully")
                                    break
                                if cond.get("type") == "Failed" and cond.get("status") == "True":
                                    log_buf.append("Copy job failed")
                                    break
                            else:
                                continue
                            break

                    if new_pod_name:
                        log_buf.append("Restarting workspace...")
                        subprocess.run(
                            ["sudo", "-u", config.DEVPOD_USER, "-E", "devpod", "up",
                             new_name, "--ide", "openvscode"],
                            capture_output=True, text=True, timeout=300, env=env)

            with config.creating_lock:
                config.creating_workspaces.pop(new_name, None)

        except Exception as e:
            log_buf.append(f"Error: {e}")
            with config.creating_lock:
                config.creating_workspaces[new_name] = {
                    "status": f"Error: {str(e)[:80]}", "started": time.time(),
                    "log_buffer": log_buf,
                }

    threading.Thread(target=_run, daemon=True).start()
    return True, f"Duplicating '{source_name}' as '{new_name}'"


def create_workspace(repo, name=""):
    from .logs import LogBuffer

    if not repo:
        return False, "Repository URL is required"
    if not name:
        name = repo.rstrip("/").split("/")[-1]
        if name.endswith(".git"):
            name = name[:-4]
        name = name.lower().replace("_", "-").replace(".", "-")

    log_buf = LogBuffer()
    with config.creating_lock:
        if name in config.creating_workspaces:
            return False, f"Workspace '{name}' is already being created"
        config.creating_workspaces[name] = {
            "status": "Creating", "started": time.time(), "log_buffer": log_buf,
        }

    def _run():
        try:
            env = _devpod_env()
            proc = subprocess.Popen(
                ["sudo", "-u", config.DEVPOD_USER, "-E", "devpod", "up", repo,
                 "--ide", "openvscode", "--provider", "kubernetes", "--id", name],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
            for line in proc.stdout:
                log_buf.append(line.rstrip("\n"))
            proc.wait(timeout=600)

            with config.creating_lock:
                if proc.returncode == 0:
                    config.creating_workspaces.pop(name, None)
                else:
                    config.creating_workspaces[name] = {
                        "status": f"Failed (rc={proc.returncode})",
                        "started": time.time(), "log_buffer": log_buf,
                    }
        except subprocess.TimeoutExpired:
            with config.creating_lock:
                config.creating_workspaces[name] = {
                    "status": "Timed out", "started": time.time(), "log_buffer": log_buf,
                }
        except Exception as e:
            log_buf.append(f"Error: {e}")
            with config.creating_lock:
                config.creating_workspaces[name] = {
                    "status": f"Error: {str(e)[:80]}", "started": time.time(),
                    "log_buffer": log_buf,
                }

    threading.Thread(target=_run, daemon=True).start()
    return True, f"Creating workspace '{name}' from {repo}"


def get_workspace_detail(ws_name):
    """Gather detailed info about a workspace: pod spec, events, PVCs, usage, git repo."""
    detail = {
        "name": ws_name, "status": "Unknown", "pod": None, "events": [],
        "pvcs": [], "containers": [], "usage": None, "repo": "",
        "running": False, "creating": False, "uid": "",
        "pod_ip": "", "node": "", "phase": "", "conditions": [], "age": "",
        "resources": {},
    }

    # Check if creating
    with config.creating_lock:
        if ws_name in config.creating_workspaces:
            cinfo = config.creating_workspaces[ws_name]
            detail["creating"] = True
            detail["status"] = cinfo["status"]
            return detail

    # Find pod
    pods = kubectl_json(["get", "pods", "-l", "devpod.sh/created=true"])
    pod_data = None
    if pods:
        for pod in pods.get("items", []):
            pod_name = pod["metadata"]["name"]
            # Check workspace name from volume mounts
            for container in pod["spec"].get("containers", []):
                for vm in container.get("volumeMounts", []):
                    mp = vm.get("mountPath", "")
                    if mp.startswith("/workspaces/") and mp != "/workspaces/.dockerless":
                        if mp.split("/")[-1] == ws_name:
                            pod_data = pod
                            break
            # Also match by pod name
            if not pod_data and pod_name == ws_name:
                pod_data = pod
            if pod_data:
                break

    if pod_data:
        meta = pod_data["metadata"]
        spec = pod_data["spec"]
        status = pod_data["status"]
        detail["pod"] = meta["name"]
        detail["uid"] = meta["labels"].get("devpod.sh/workspace-uid", "")
        detail["phase"] = status.get("phase", "")
        detail["status"] = status.get("phase", "Unknown")
        detail["running"] = status.get("phase") == "Running"
        detail["pod_ip"] = status.get("podIP", "")
        detail["node"] = spec.get("nodeName", "")
        detail["conditions"] = status.get("conditions", [])

        # Age
        created = meta.get("creationTimestamp", "")
        if created:
            try:
                ct = datetime.fromisoformat(created.replace("Z", "+00:00"))
                delta = datetime.now(timezone.utc) - ct
                days = delta.days
                hours = delta.seconds // 3600
                mins = (delta.seconds % 3600) // 60
                if days > 0:
                    detail["age"] = f"{days}d {hours}h"
                elif hours > 0:
                    detail["age"] = f"{hours}h {mins}m"
                else:
                    detail["age"] = f"{mins}m"
            except Exception:
                detail["age"] = created

        # Containers
        for c in spec.get("containers", []):
            c_status = {}
            for cs in status.get("containerStatuses", []):
                if cs["name"] == c["name"]:
                    c_status = cs
                    break
            c_res = c.get("resources", {})
            detail["containers"].append({
                "name": c["name"],
                "image": c.get("image", ""),
                "ready": c_status.get("ready", False),
                "restart_count": c_status.get("restartCount", 0),
                "state": c_status.get("state", {}),
                "requests": c_res.get("requests", {}),
                "limits": c_res.get("limits", {}),
            })
            detail["resources"] = {
                "req_cpu": c_res.get("requests", {}).get("cpu", ""),
                "req_mem": c_res.get("requests", {}).get("memory", ""),
                "lim_cpu": c_res.get("limits", {}).get("cpu", ""),
                "lim_mem": c_res.get("limits", {}).get("memory", ""),
            }

        # Git repo
        if detail["running"]:
            detail["repo"] = get_git_repo_for_pod(meta["name"], ws_name)

        # kubectl top (best-effort)
        try:
            r = kubectl(["top", "pod", meta["name"], "--no-headers"])
            if r.returncode == 0:
                parts = r.stdout.strip().split()
                if len(parts) >= 3:
                    detail["usage"] = {"cpu": parts[1], "memory": parts[2]}
        except Exception:
            pass

        # Events
        try:
            events = kubectl_json(["get", "events",
                                   "--field-selector", f"involvedObject.name={meta['name']}",
                                   "--sort-by=.lastTimestamp"])
            if events:
                for ev in events.get("items", []):
                    ts = ev.get("lastTimestamp", ev.get("eventTime", ""))
                    age = ""
                    if ts:
                        try:
                            et = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                            delta = datetime.now(timezone.utc) - et
                            if delta.days > 0:
                                age = f"{delta.days}d"
                            elif delta.seconds >= 3600:
                                age = f"{delta.seconds // 3600}h"
                            elif delta.seconds >= 60:
                                age = f"{delta.seconds // 60}m"
                            else:
                                age = f"{delta.seconds}s"
                        except Exception:
                            age = ts
                    detail["events"].append({
                        "type": ev.get("type", ""),
                        "reason": ev.get("reason", ""),
                        "age": age,
                        "message": ev.get("message", ""),
                    })
        except Exception:
            pass

    else:
        # Check saved configmaps for stopped workspaces
        cms = kubectl_json(["get", "configmap", "-l", "managed-by=devpod-dashboard"])
        if cms:
            for cm in cms.get("items", []):
                ws_label = cm["metadata"]["labels"].get("workspace-name", "")
                if ws_label == ws_name:
                    detail["status"] = "Stopped"
                    detail["uid"] = cm["metadata"]["labels"].get("workspace-uid", "")
                    data = json.loads(cm["data"].get("spec", "{}"))
                    detail["pod"] = data.get("metadata", {}).get("name", "")
                    for c in data.get("spec", {}).get("containers", []):
                        c_res = c.get("resources", {})
                        detail["containers"].append({
                            "name": c["name"],
                            "image": c.get("image", ""),
                            "ready": False,
                            "restart_count": 0,
                            "state": {},
                            "requests": c_res.get("requests", {}),
                            "limits": c_res.get("limits", {}),
                        })
                        detail["resources"] = {
                            "req_cpu": c_res.get("requests", {}).get("cpu", ""),
                            "req_mem": c_res.get("requests", {}).get("memory", ""),
                            "lim_cpu": c_res.get("limits", {}).get("cpu", ""),
                            "lim_mem": c_res.get("limits", {}).get("memory", ""),
                        }
                    break

    # PVCs
    try:
        all_pvcs = kubectl_json(["get", "pvc"])
        if all_pvcs:
            for pvc in all_pvcs.get("items", []):
                pn = pvc["metadata"]["name"]
                # Match by UID label or pod name in PVC name
                pvc_uid = pvc["metadata"].get("labels", {}).get("devpod.sh/workspace-uid", "")
                if (detail["uid"] and pvc_uid == detail["uid"]) or \
                   (detail["pod"] and detail["pod"] in pn):
                    cap = pvc.get("status", {}).get("capacity", {}).get("storage", "")
                    detail["pvcs"].append({
                        "name": pn,
                        "capacity": cap,
                        "status": pvc.get("status", {}).get("phase", ""),
                        "storage_class": pvc.get("spec", {}).get("storageClassName", ""),
                    })
    except Exception:
        pass

    return detail
