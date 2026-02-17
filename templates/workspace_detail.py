"""Workspace detail page rendering."""

import html as html_mod
from datetime import datetime, timezone

from ..auth import get_host_ip
from .base import wrap_page
from .styles import DETAIL_PAGE_CSS
from .scripts import DETAIL_PAGE_JS


def render_workspace_detail_page(detail, user="admin"):
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

    # Expiry warning banner (Feature 5)
    expiry_banner = ""
    if detail.get("expiry_warning") and not creating:
        expiry_banner = '<div class="expiry-warning">This workspace will be auto-deleted in ~24h due to inactivity</div>'

    # Action buttons
    esc_repo = repo.replace("'", "\\'")
    if creating:
        actions_html = '<span class="muted">Creating... please wait</span>'
    elif running:
        res = detail.get("resources", {})
        actions_html = (
            f'<button class="btn btn-red" onclick="doAction(\'stop\',\'{pod}\')">Stop</button> '
            f'<button class="btn btn-sm" style="background:#30363d;color:#c9d1d9" '
            f'onclick="promptDuplicate(\'{name}\',\'{pod}\',\'{esc_repo}\')">Duplicate</button> '
            f'<button class="btn btn-sm" style="background:#1c2129;color:var(--link);border:1px solid var(--border2)" '
            f'onclick="saveAsTemplate(\'{name}\',\'{esc_repo}\','
            f'\'{res.get("req_cpu","4")}\',\'{res.get("req_mem","8Gi")}\','
            f'\'{res.get("lim_cpu","24")}\',\'{res.get("lim_mem","64Gi")}\')">Save as Template</button> '
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

        # Owner field (Feature 4)
        owner = detail.get("owner", "")
        owner_html = f"<dt>Owner</dt><dd>{html_mod.escape(owner) if owner else '--'}</dd>" if owner else ""

        # Last activity (Feature 5)
        last_accessed = detail.get("last_accessed", "")
        last_activity_html = ""
        if last_accessed:
            try:
                la_dt = datetime.fromisoformat(last_accessed.replace("Z", "+00:00"))
                delta = datetime.now(timezone.utc) - la_dt
                days = delta.days
                hours = delta.seconds // 3600
                if days > 0:
                    la_text = f"{days}d ago"
                elif hours > 0:
                    la_text = f"{hours}h ago"
                else:
                    mins = delta.seconds // 60
                    la_text = f"{mins}m ago"
                last_activity_html = f"<dt>Last Activity</dt><dd>{la_text}</dd>"
            except Exception:
                pass

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
        {owner_html}
        {last_activity_html}
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

    # Git status card (Feature 1) - running workspaces only
    git_card = ""
    if running and detail.get("branch"):
        branch = html_mod.escape(detail.get("branch", ""))
        dirty = detail.get("dirty", False)
        status_cls = "dirty" if dirty else "clean"
        status_text = "Dirty" if dirty else "Clean"
        last_commit = html_mod.escape(detail.get("last_commit", "--"))
        git_card = f"""\
    <div class="card">
      <h3>Git Status</h3>
      <dl class="kv">
        <dt>Branch</dt><dd>{branch}</dd>
        <dt>Status</dt><dd><span class="git-status-badge {status_cls}">{status_text}</span></dd>
        <dt>Last Commit</dt><dd>{last_commit}</dd>
      </dl>
    </div>"""

    # Usage history sparklines card (Feature 3) - running workspaces only
    sparkline_card = ""
    if running and pod:
        sparkline_card = f"""\
    <div class="card card-full sparkline-card">
      <h3>Usage History (Last 24h)</h3>
      <div class="sparkline-row">
        <div class="sparkline-item">
          <div class="sparkline-header">
            <span class="sparkline-label">CPU</span>
            <span class="sparkline-value" id="sparkline-cpu-val">--</span>
          </div>
          <div class="sparkline-chart"><svg id="sparkline-cpu" viewBox="0 0 200 40" preserveAspectRatio="none"></svg></div>
          <div class="sparkline-range"><span id="sparkline-cpu-min"></span><span id="sparkline-cpu-max"></span></div>
        </div>
        <div class="sparkline-item">
          <div class="sparkline-header">
            <span class="sparkline-label">Memory</span>
            <span class="sparkline-value" id="sparkline-mem-val">--</span>
          </div>
          <div class="sparkline-chart"><svg id="sparkline-mem" viewBox="0 0 200 40" preserveAspectRatio="none"></svg></div>
          <div class="sparkline-range"><span id="sparkline-mem-min"></span><span id="sparkline-mem-max"></span></div>
        </div>
      </div>
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

    # PVCs card (Feature 2: enhanced with usage)
    pvc_usage = detail.get("pvc_usage", {})
    pvcs_html = ""
    for pvc in detail.get("pvcs", []):
        usage_cols = ""
        if running and pvc_usage:
            pct = pvc_usage.get("percent", 0)
            bar_color = "#f85149" if pct >= 80 else "#d29922" if pct >= 60 else "#3fb950"
            usage_cols = (
                f'<td>{html_mod.escape(pvc_usage.get("used", "--"))} / {html_mod.escape(pvc_usage.get("total", "--"))}'
                f' <div class="pvc-bar"><div class="bar-seg" style="width:{pct}%;background:{bar_color}"></div></div></td>'
                f'<td>{pct}%</td>')
        elif running:
            usage_cols = '<td>--</td><td>--</td>'

        pvcs_html += (
            f'<tr><td>{html_mod.escape(pvc.get("name", ""))}</td>'
            f'<td>{html_mod.escape(pvc.get("capacity", "--"))}</td>'
            f'{usage_cols}'
            f'<td>{html_mod.escape(pvc.get("status", ""))}</td>'
            f'<td>{html_mod.escape(pvc.get("storage_class", ""))}</td></tr>')

    pvcs_card = ""
    if detail.get("pvcs"):
        usage_headers = '<th>Used</th><th>%</th>' if running else ''
        pvcs_card = f"""\
    <div class="card card-full">
      <h3>Persistent Volume Claims</h3>
      <table>
        <thead><tr><th>Name</th><th>Capacity</th>{usage_headers}<th>Status</th><th>Storage Class</th></tr></thead>
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

    # Terminal card (running workspaces only)
    terminal_card = ""
    if running and pod:
        terminal_card = f"""\
    <div class="card card-full">
      <h3>Terminal</h3>
      <div class="term-controls">
        <button class="btn btn-green btn-sm" id="term-connect-btn"
                onclick="connectTerminal('{html_mod.escape(pod)}')">Connect</button>
        <button class="btn btn-red btn-sm" id="term-disconnect-btn"
                onclick="disconnectTerminal()" style="display:none">Disconnect</button>
        <span class="term-status" id="term-status">Ready</span>
      </div>
      <div id="terminal-container"></div>
    </div>"""

    # Schedule card (non-creating workspaces)
    def _sched_row(action_label, prefix):
        days_html = ""
        for d in ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]:
            days_html += (f'<label><input type="checkbox" id="sched-{prefix}-{d}">{d}</label>')
        return (
            f'<div class="schedule-row">'
            f'<span class="sched-label">{action_label}</span>'
            f'<div class="day-checks">{days_html}</div>'
            f'<input type="time" id="sched-{prefix}-time">'
            f'<button class="btn btn-blue btn-sm" onclick="saveSchedule(\'{prefix}\')">Set</button>'
            f'<button class="btn btn-sm" style="background:var(--border2);color:var(--text)" '
            f'onclick="removeSchedule(\'{prefix}\')">Remove</button>'
            f'</div>')

    schedule_card = ""
    if not creating:
        schedule_card = f"""\
    <div class="card card-full">
      <h3>Schedules (UTC)</h3>
      {_sched_row("Auto-Start", "start")}
      {_sched_row("Auto-Stop", "stop")}
    </div>"""

    # Repo display
    repo_html = ""
    if repo:
        repo_short = repo.replace("https://github.com/", "").replace("https://", "")
        repo_html = f' &middot; <a href="{html_mod.escape(repo)}" target="_blank">{html_mod.escape(repo_short)}</a>'

    body = f"""\
<div class="breadcrumb"><a href="/">Dashboard</a> &gt; {html_mod.escape(name)}</div>
{expiry_banner}
<div class="detail-header">
  <h1>{html_mod.escape(name)}</h1>
  <span class="status-badge {badge_cls}">{html_mod.escape(badge_text)}</span>
  {f'<span style="color:var(--muted);font-size:0.8rem">{repo_html}</span>' if repo_html else ''}
  <div class="detail-actions">{actions_html}</div>
</div>

<div class="cards">
  {pod_info}
  {resources_card}
  {git_card}
  {sparkline_card}
  {containers_card}
  {events_card}
  {pvcs_card}
  {logs_card}
  {terminal_card}
  {schedule_card}
</div>"""

    # Inject WS_NAME/POD_NAME vars and append init JS
    esc_name_js = name.replace("\\", "\\\\").replace("'", "\\'")
    esc_pod_js = pod.replace("\\", "\\\\").replace("'", "\\'")
    js = f"const WS_NAME='{esc_name_js}';const POD_NAME='{esc_pod_js}';\n" + DETAIL_PAGE_JS
    if log_init_js:
        js += f"\n{log_init_js}"

    # xterm.js CDN for running workspaces
    head_extra = ""
    if running:
        head_extra = (
            '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">\n'
            '<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>\n'
            '<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>')

    return wrap_page(f"{name} - DevPod", body, DETAIL_PAGE_CSS, js, head_extra=head_extra)
