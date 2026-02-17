"""Workspace detail page rendering."""

import html as html_mod

from ..auth import get_host_ip
from .base import wrap_page
from .styles import DETAIL_PAGE_CSS
from .scripts import DETAIL_PAGE_JS


def render_workspace_detail_page(detail):
    ip = get_host_ip()
    name = detail["name"]
    status = detail["status"]
    pod = detail.get("pod", "") or ""
    uid = detail.get("uid", "") or ""
    repo = detail.get("repo", "") or ""
    running = detail.get("running", False)
    creating = detail.get("creating", False)

    # Status badge
    if creating:
        badge_cls = "creating"
        badge_text = status
    elif running:
        badge_cls = "running"
        badge_text = "Running"
    elif status == "Stopped":
        badge_cls = "stopped"
        badge_text = "Stopped"
    else:
        badge_cls = "stopped"
        badge_text = status

    # Action buttons
    esc_repo = repo.replace("'", "\\'")
    if creating:
        actions_html = '<span class="muted">Creating... please wait</span>'
    elif running:
        actions_html = (
            f'<button class="btn btn-red" onclick="doAction(\'stop\',\'{pod}\')">Stop</button> '
            f'<button class="btn btn-sm" style="background:#30363d;color:#c9d1d9" '
            f'onclick="promptDuplicate(\'{name}\',\'{pod}\',\'{esc_repo}\')">Duplicate</button> '
            f'<button class="btn btn-outline-red" '
            f'onclick="confirmDelete(this,\'{name}\',\'{pod}\',\'{uid}\')">Delete</button>')
    else:
        actions_html = (
            f'<button class="btn btn-green" onclick="doAction(\'start\',\'{pod}\')">Start</button> '
            f'<button class="btn btn-outline-red" '
            f'onclick="confirmDelete(this,\'{name}\',\'{pod}\',\'{uid}\')">Delete</button>')

    # Pod info card
    pod_info = ""
    if pod and not creating:
        conditions_html = ""
        for cond in detail.get("conditions", []):
            c_type = cond.get("type", "")
            c_status = cond.get("status", "")
            color = "#3fb950" if c_status == "True" else "#f85149"
            conditions_html += f'<span style="color:{color};margin-right:0.5rem">{c_type}</span>'

        pod_info = f"""\
    <div class="card">
      <h3>Pod Info</h3>
      <dl class="kv">
        <dt>Pod Name</dt><dd>{html_mod.escape(pod)}</dd>
        <dt>Node</dt><dd>{html_mod.escape(detail.get('node', '--'))}</dd>
        <dt>Phase</dt><dd>{html_mod.escape(detail.get('phase', '--'))}</dd>
        <dt>Pod IP</dt><dd>{html_mod.escape(detail.get('pod_ip', '--'))}</dd>
        <dt>Age</dt><dd>{html_mod.escape(detail.get('age', '--'))}</dd>
        <dt>Conditions</dt><dd>{conditions_html or '--'}</dd>
      </dl>
    </div>"""

    # Resources card
    res = detail.get("resources", {})
    usage = detail.get("usage")
    usage_html = ""
    if usage:
        usage_html = f"""
        <dt>Actual CPU</dt><dd>{html_mod.escape(usage.get('cpu', '--'))}</dd>
        <dt>Actual Memory</dt><dd>{html_mod.escape(usage.get('memory', '--'))}</dd>"""

    resources_card = ""
    if res:
        resources_card = f"""\
    <div class="card">
      <h3>Resources</h3>
      <dl class="kv">
        <dt>CPU Request</dt><dd>{html_mod.escape(res.get('req_cpu', '--'))}</dd>
        <dt>CPU Limit</dt><dd>{html_mod.escape(res.get('lim_cpu', '--'))}</dd>
        <dt>Memory Request</dt><dd>{html_mod.escape(res.get('req_mem', '--'))}</dd>
        <dt>Memory Limit</dt><dd>{html_mod.escape(res.get('lim_mem', '--'))}</dd>{usage_html}
      </dl>
    </div>"""

    # Containers card
    containers_html = ""
    for c in detail.get("containers", []):
        state = c.get("state", {})
        state_text = ""
        for k, v in state.items():
            reason = v.get("reason", "") if isinstance(v, dict) else ""
            state_text = f"{k}" + (f" ({reason})" if reason else "")
            break
        if not state_text:
            state_text = "--"

        ready_color = "#3fb950" if c.get("ready") else "#f85149"
        containers_html += f"""\
      <tr>
        <td>{html_mod.escape(c.get('name', ''))}</td>
        <td style="font-size:0.72rem;font-family:monospace">{html_mod.escape(c.get('image', ''))}</td>
        <td style="color:{ready_color}">{'Yes' if c.get('ready') else 'No'}</td>
        <td>{c.get('restart_count', 0)}</td>
        <td>{html_mod.escape(state_text)}</td>
      </tr>"""

    containers_card = ""
    if detail.get("containers"):
        containers_card = f"""\
    <div class="card card-full">
      <h3>Containers</h3>
      <table>
        <thead><tr><th>Name</th><th>Image</th><th>Ready</th><th>Restarts</th><th>State</th></tr></thead>
        <tbody>{containers_html}</tbody>
      </table>
    </div>"""

    # Events card
    events_html = ""
    for ev in detail.get("events", []):
        ev_type = ev.get("type", "Normal")
        type_cls = "event-type-warning" if ev_type == "Warning" else "event-type-normal"
        events_html += (
            f'<tr><td class="{type_cls}">{html_mod.escape(ev_type)}</td>'
            f'<td>{html_mod.escape(ev.get("reason", ""))}</td>'
            f'<td>{html_mod.escape(ev.get("age", ""))}</td>'
            f'<td>{html_mod.escape(ev.get("message", ""))}</td></tr>')

    events_card = ""
    if detail.get("events"):
        events_card = f"""\
    <div class="card card-full">
      <h3>Events</h3>
      <table class="event-table">
        <thead><tr><th>Type</th><th>Reason</th><th>Age</th><th>Message</th></tr></thead>
        <tbody>{events_html}</tbody>
      </table>
    </div>"""

    # PVCs card
    pvcs_html = ""
    for pvc in detail.get("pvcs", []):
        pvcs_html += (
            f'<tr><td>{html_mod.escape(pvc.get("name", ""))}</td>'
            f'<td>{html_mod.escape(pvc.get("capacity", "--"))}</td>'
            f'<td>{html_mod.escape(pvc.get("status", ""))}</td>'
            f'<td>{html_mod.escape(pvc.get("storage_class", ""))}</td></tr>')

    pvcs_card = ""
    if detail.get("pvcs"):
        pvcs_card = f"""\
    <div class="card card-full">
      <h3>Persistent Volume Claims</h3>
      <table>
        <thead><tr><th>Name</th><th>Capacity</th><th>Status</th><th>Storage Class</th></tr></thead>
        <tbody>{pvcs_html}</tbody>
      </table>
    </div>"""

    # Logs card
    if creating:
        log_controls = f"""\
      <div class="log-controls">
        <span class="log-status" id="log-status">Loading creation logs...</span>
      </div>"""
        log_init_js = f"startCreationLogPoll('{name}');"
    elif running:
        log_controls = f"""\
      <div class="log-controls">
        <button class="btn btn-green btn-sm" id="log-stream-btn"
                onclick="startLogStream('{html_mod.escape(pod)}')">Start streaming</button>
        <span class="log-status" id="log-status">Ready</span>
      </div>"""
        log_init_js = ""
    else:
        log_controls = """\
      <div class="log-controls">
        <span class="log-status" id="log-status">Workspace is stopped</span>
      </div>"""
        log_init_js = ""

    logs_card = f"""\
    <div class="card card-full">
      <h3>Logs</h3>
      {log_controls}
      <div class="log-viewer" id="log-content"></div>
    </div>"""

    # Repo display
    repo_html = ""
    if repo:
        repo_short = repo.replace("https://github.com/", "").replace("https://", "")
        repo_html = f' &middot; <a href="{html_mod.escape(repo)}" target="_blank">{html_mod.escape(repo_short)}</a>'

    body = f"""\
<div class="breadcrumb"><a href="/">Dashboard</a> &gt; {html_mod.escape(name)}</div>
<div class="detail-header">
  <h1>{html_mod.escape(name)}</h1>
  <span class="status-badge {badge_cls}">{html_mod.escape(badge_text)}</span>
  {f'<span style="color:var(--muted);font-size:0.8rem">{repo_html}</span>' if repo_html else ''}
  <div class="detail-actions">{actions_html}</div>
</div>

<div class="cards">
  {pod_info}
  {resources_card}
  {containers_card}
  {events_card}
  {pvcs_card}
  {logs_card}
</div>"""

    # Append init JS for log viewer
    js = DETAIL_PAGE_JS
    if log_init_js:
        js += f"\n{log_init_js}"

    return wrap_page(f"{name} - DevPod", body, DETAIL_PAGE_CSS, js)
