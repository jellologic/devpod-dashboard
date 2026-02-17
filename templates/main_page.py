"""Main dashboard page rendering."""

import html as html_mod
from datetime import datetime, timezone

from ..auth import get_host_ip
from .. import config
from ..schedules import get_schedules as _get_all_schedules, get_expiry_days
from .base import wrap_page
from .styles import MAIN_PAGE_CSS
from .scripts import MAIN_PAGE_JS


def render_main_page(workspaces, settings, user="admin"):
    ip = get_host_ip()
    with config.stats_lock:
        st = dict(config.sys_stats)

    cpu = st.get("cpu", {})
    ncpu = st.get("ncpu", 0)
    overall_cpu = cpu.get("cpu", 0)
    mem = st.get("mem", {})
    swap = st.get("swap", {})
    load = st.get("load", [0, 0, 0])
    disk = st.get("disk", {})
    uptime = st.get("uptime", "?")
    tasks = st.get("tasks", "?")
    procs = st.get("procs", [])

    # CPU core grid
    core_cells = ""
    cores = sorted([k for k in cpu if k != "cpu"], key=lambda x: int(x[3:]))
    for c in cores:
        pct = cpu[c]
        color = "#f85149" if pct >= 80 else "#d29922" if pct >= 50 else "#3fb950" if pct >= 20 else "#238636"
        cnum = c[3:]
        core_cells += (
            f'<div class="core" title="CPU {cnum}: {pct}%">'
            f'<span class="core-id">{cnum}</span>'
            f'<div class="core-bar"><div class="core-fill" style="width:{max(1,pct)}%;background:{color}"></div></div>'
            f'</div>\n')

    mem_total = mem.get("total", 1)
    mem_used_app = mem.get("used", 0) - mem.get("buffers", 0) - mem.get("cached", 0)
    if mem_used_app < 0:
        mem_used_app = mem.get("used", 0)
    mem_buf_pct = 100.0 * mem.get("buffers", 0) / mem_total if mem_total else 0
    mem_cache_pct = 100.0 * mem.get("cached", 0) / mem_total if mem_total else 0
    mem_used_pct = 100.0 * mem_used_app / mem_total if mem_total else 0
    swap_total = swap.get("total", 0)
    swap_used = swap.get("used", 0)
    swap_pct = 100.0 * swap_used / swap_total if swap_total else 0
    disk_total = disk.get("total", 1)
    disk_used = disk.get("used", 0)
    disk_pct = 100.0 * disk_used / disk_total if disk_total else 0

    def gb(b):
        return f"{b / (1024**3):.1f}G"
    def kbg(k):
        return f"{k / (1024*1024):.1f}G"

    proc_rows = ""
    for p in procs:
        proc_rows += (
            f'<tr><td>{p["pid"]}</td><td>{p["user"]}</td>'
            f'<td class="num">{p["cpu"]}</td><td class="num">{p["mem"]}</td>'
            f'<td class="num">{p["rss"]/1024:.0f}M</td><td class="cmd">{p["cmd"]}</td></tr>\n')

    # Settings values
    prov = settings.get("provider", {})
    lr = settings.get("limitrange", {})
    quota = settings.get("quota", {})

    # Schedule indicator
    try:
        _all_scheds = _get_all_schedules()
        schedule_names = {s.get("workspace") for s in _all_scheds}
    except Exception:
        schedule_names = set()

    # Expiry days for settings panel
    try:
        expiry_days = get_expiry_days()
    except Exception:
        expiry_days = 0

    # User display
    user_display = f" &middot; Logged in as <strong>{html_mod.escape(user)}</strong>" if user else ""

    # Workspace rows
    ws_rows = ""
    for w in workspaces:
        r = w.get("resources", {})
        res_display = f'{r.get("lim_cpu", "?")}c / {r.get("lim_mem", "?")}' if r else "--"
        res_req = f'{r.get("req_cpu", "")}c / {r.get("req_mem", "")}' if r and r.get("req_cpu") else ""
        repo = w.get("repo", "")
        repo_short = repo.replace("https://github.com/", "").replace("https://", "") if repo else ""

        # Git branch info (Feature 1)
        branch = w.get("branch", "")
        dirty = w.get("dirty", False)
        git_branch_html = ""
        if branch and w.get("running", False):
            dot_cls = "dirty" if dirty else "clean"
            git_branch_html = f' <span class="git-dot {dot_cls}"></span><span class="git-branch">{html_mod.escape(branch)}</span>'

        # Expiry indicator (Feature 5)
        expiry_icon = ""
        if w.get("expiry_warning"):
            expiry_icon = ' <span class="expiry-icon" title="Approaching expiry">&#9203;</span>'

        # Workspace name as link to detail page
        sched_icon = ' <span title="Has schedule" style="font-size:0.72rem">&#128339;</span>' if w["name"] in schedule_names else ""
        name_html = f'<a href="/workspace/{w["name"]}" class="ws-name-link">{w["name"]}</a>{sched_icon}{expiry_icon}'

        # Usage cell (actual CPU/memory from kubectl top)
        usage = w.get("usage", {})
        if usage:
            usage_cell = (f'<span class="usage-display">'
                          f'<span class="usage-cpu">{usage.get("cpu", "--")}</span>'
                          f' / '
                          f'<span class="usage-mem">{usage.get("memory", "--")}</span>'
                          f'</span>')
        else:
            usage_cell = '<span class="muted">--</span>'

        if w["creating"]:
            check_cell = '<td></td>'
            status_html = '<span class="st-creating">Creating...</span>'
            link = '<span class="muted">--</span>'
            actions = '<span class="muted">please wait</span>'
            timer_cell = '<span class="muted">--</span>'
            res_cell = '<span class="muted">--</span>'
            repo_cell = '<span class="muted">--</span>'
            usage_cell = '<span class="muted">--</span>'
        elif w["running"]:
            check_cell = (f'<td><input type="checkbox" class="ws-check" data-pod="{w["pod"]}" '
                          f'data-name="{w["name"]}" data-uid="{w["uid"]}" data-running="1" '
                          f'onchange="updateBulkBar()"></td>')
            status_html = '<span class="st-running">Running</span>'
            if w["port"]:
                url = f"http://{ip}:{w['port']}/?folder=/workspaces/{w['name']}"
                link = f'<a href="{url}" target="_blank">{ip}:{w["port"]}</a>'
            else:
                link = '<span class="muted">pending...</span>'
            repo_cell = f'<a href="{repo}" target="_blank" class="repo-link" title="{repo}">{repo_short}</a>{git_branch_html}' if repo else '<span class="muted">--</span>'
            esc_repo = repo.replace("'", "\\'")
            actions = (
                f'<button class="btn btn-red" onclick="doAction(\'stop\',\'{w["pod"]}\')">Stop</button> '
                f'<button class="btn btn-sm" style="background:#30363d;color:#c9d1d9" onclick="promptDuplicate(\'{w["name"]}\',\'{w["pod"]}\',\'{esc_repo}\')">Duplicate</button> '
                f'<button class="btn btn-outline-red" onclick="confirmDelete(this,\'{w["name"]}\',\'{w["pod"]}\',\'{w["uid"]}\')">Delete</button>')
            if w["shutdown_at"]:
                try:
                    sa = datetime.fromisoformat(w["shutdown_at"])
                    rem = sa - datetime.now(timezone.utc)
                    if rem.total_seconds() > 0:
                        td = f"{int(rem.total_seconds()//3600)}h {int((rem.total_seconds()%3600)//60)}m left"
                    else:
                        td = "Shutting down..."
                except Exception:
                    td = w["shutdown_hours"] + "h"
            else:
                td = "None"
            timer_cell = (
                f'<span class="timer-display">{td}</span>'
                f'<select class="timer-select" onchange="setTimer(\'{w["pod"]}\',this.value)">'
                f'<option value="">Set...</option><option value="1">1h</option>'
                f'<option value="2">2h</option><option value="4">4h</option>'
                f'<option value="8">8h</option><option value="12">12h</option>'
                f'<option value="24">24h</option><option value="0">Off</option></select>')
            res_cell = (
                f'<span class="res-display" title="req: {res_req}">{res_display}</span> '
                f'<button class="btn-icon" onclick="showResize(this,\'{w["pod"]}\',\'{w["uid"]}\','
                f'\'{r.get("req_cpu","4")}\',\'{r.get("req_mem","8Gi")}\','
                f'\'{r.get("lim_cpu","24")}\',\'{r.get("lim_mem","64Gi")}\')">&#9998;</button>')
        else:
            check_cell = (f'<td><input type="checkbox" class="ws-check" data-pod="{w["pod"]}" '
                          f'data-name="{w["name"]}" data-uid="{w["uid"]}" data-running="0" '
                          f'onchange="updateBulkBar()"></td>')
            status_html = '<span class="st-stopped">Stopped</span>'
            link = '<span class="muted">--</span>'
            repo_cell = f'<span class="repo-link" title="{repo}">{repo_short}</span>' if repo else '<span class="muted">--</span>'
            actions = (
                f'<button class="btn btn-green" onclick="doAction(\'start\',\'{w["pod"]}\')">Start</button> '
                f'<button class="btn btn-outline-red" onclick="confirmDelete(this,\'{w["name"]}\',\'{w["pod"]}\',\'{w["uid"]}\')">Delete</button>')
            timer_cell = '<span class="muted">--</span>'
            res_cell = (
                f'<span class="res-display" title="req: {res_req}">{res_display}</span> '
                f'<button class="btn-icon" onclick="showResize(this,\'{w["pod"]}\',\'{w["uid"]}\','
                f'\'{r.get("req_cpu","4")}\',\'{r.get("req_mem","8Gi")}\','
                f'\'{r.get("lim_cpu","24")}\',\'{r.get("lim_mem","64Gi")}\')">&#9998;</button>'
            ) if r else '<span class="muted">--</span>'

        ws_rows += (
            f'<tr>{check_cell}<td>{status_html}</td><td>{name_html}</td>'
            f'<td>{repo_cell}</td><td>{link}</td><td>{res_cell}</td><td>{usage_cell}</td><td>{timer_cell}</td><td>{actions}</td></tr>\n')

    ws_count = len([w for w in workspaces if w["running"]])
    ws_total = len(workspaces)

    body = f"""\
<h1>DevPod Dashboard</h1>
<p class="subtitle">{ws_count} running, {ws_total} workspaces &middot; {ncpu} cores &middot; {uptime} uptime &middot; {ip}{user_display}</p>

<!-- System Overview -->
<div class="sys">
  <div class="sys-card">
    <h3>CPU &middot; {ncpu} cores</h3>
    <div class="cpu-overall">{overall_cpu}% <span>avg</span></div>
    <div class="cpu-grid">{core_cells}</div>
  </div>
  <div class="sys-card">
    <h3>Resources</h3>
    <div class="metric">
      <div class="metric-label"><span>Memory</span><span>{kbg(mem.get('used',0))} / {kbg(mem_total)} ({mem.get('used',0)*100//max(mem_total,1)}%)</span></div>
      <div class="bar">
        <div class="bar-seg" style="width:{mem_used_pct:.1f}%;background:#3fb950"></div>
        <div class="bar-seg" style="width:{mem_buf_pct:.1f}%;background:#1f6feb"></div>
        <div class="bar-seg" style="width:{mem_cache_pct:.1f}%;background:#d29922"></div>
      </div>
      <div style="font-size:0.65rem;color:var(--muted);margin-top:2px">
        <span style="color:#3fb950">&#9632;</span> used
        <span style="color:#1f6feb;margin-left:6px">&#9632;</span> buffers
        <span style="color:#d29922;margin-left:6px">&#9632;</span> cache
      </div>
    </div>
    <div class="metric">
      <div class="metric-label"><span>Swap</span><span>{kbg(swap_used)} / {kbg(swap_total)}</span></div>
      <div class="bar"><div class="bar-seg" style="width:{swap_pct:.1f}%;background:#f85149"></div></div>
    </div>
    <div class="metric">
      <div class="metric-label"><span>Disk /</span><span>{gb(disk_used)} / {gb(disk_total)} ({disk_pct:.0f}%)</span></div>
      <div class="bar"><div class="bar-seg" style="width:{disk_pct:.1f}%;background:#1f6feb"></div></div>
    </div>
    <div class="chips" style="margin-top:0.5rem">
      <div class="chip"><span class="val">{load[0]:.2f}</span> <span class="lbl">1m</span>
        <span class="val" style="margin-left:6px">{load[1]:.2f}</span> <span class="lbl">5m</span>
        <span class="val" style="margin-left:6px">{load[2]:.2f}</span> <span class="lbl">15m</span></div>
      <div class="chip"><span class="val">{tasks}</span> <span class="lbl">tasks</span></div>
    </div>
  </div>
</div>

<!-- Settings -->
<div class="settings-toggle" onclick="document.getElementById('settings').classList.toggle('open')">&#9881; Settings</div>
<div id="settings" class="settings-panel">
  <div class="settings-group">
    <h4>New Workspace Defaults (DevPod Provider)</h4>
    <div class="settings-row">
      <label>CPU request</label><input id="s-prov-rcpu" value="{prov.get('req_cpu','4')}">
      <span class="sep">limit</span><input id="s-prov-lcpu" value="{prov.get('lim_cpu','24')}">
    </div>
    <div class="settings-row">
      <label>Memory request</label><input id="s-prov-rmem" value="{prov.get('req_mem','8Gi')}">
      <span class="sep">limit</span><input id="s-prov-lmem" value="{prov.get('lim_mem','64Gi')}">
    </div>
    <div class="settings-row">
      <button class="btn btn-blue btn-sm" onclick="saveProvider()">Save Defaults</button>
    </div>
  </div>
  <div class="settings-group">
    <h4>Per-Container Max (LimitRange)</h4>
    <div class="settings-row">
      <label>Max CPU</label><input id="s-lr-mcpu" value="{lr.get('max_cpu','24')}">
      <label>Max Memory</label><input id="s-lr-mmem" value="{lr.get('max_mem','64Gi')}">
    </div>
    <div class="settings-row">
      <label>Default req CPU</label><input id="s-lr-drcpu" value="{lr.get('def_req_cpu','4')}">
      <label>Default req Mem</label><input id="s-lr-drmem" value="{lr.get('def_req_mem','8Gi')}">
    </div>
    <div class="settings-row">
      <button class="btn btn-blue btn-sm" onclick="saveLimitRange()">Save LimitRange</button>
    </div>
  </div>
  <div class="settings-group">
    <h4>Namespace Quota (ResourceQuota)</h4>
    <div class="settings-row">
      <label>Total CPU req</label><input id="s-q-cpu" value="{quota.get('req_cpu','72')}">
      <span class="settings-used">used: {quota.get('used_req_cpu','?')}</span>
    </div>
    <div class="settings-row">
      <label>Total Mem req</label><input id="s-q-mem" value="{quota.get('req_mem','192Gi')}">
      <span class="settings-used">used: {quota.get('used_req_mem','?')}</span>
    </div>
    <div class="settings-row">
      <label>Max pods</label><input id="s-q-pods" value="{quota.get('pods','20')}">
      <span class="settings-used">used: {quota.get('used_pods','?')}</span>
    </div>
    <div class="settings-row">
      <button class="btn btn-blue btn-sm" onclick="saveQuota()">Save Quota</button>
    </div>
  </div>
  <div class="settings-group">
    <h4>Workspace Expiry</h4>
    <div class="settings-row">
      <label>Expire after (days)</label><input id="s-expiry-days" value="{expiry_days}" style="width:60px">
      <span class="settings-used">0 = disabled</span>
    </div>
    <div class="settings-row">
      <button class="btn btn-blue btn-sm" onclick="saveExpiry()">Save Expiry</button>
    </div>
  </div>
</div>

<!-- Workspaces -->
<h2>Workspaces</h2>
<div class="create-bar">
  <input type="text" id="repo" class="repo" placeholder="Git repo URL (e.g. github.com/org/repo)">
  <input type="text" id="ws-name" class="ws-name" placeholder="Name (optional)">
  <button class="btn btn-blue" id="create-btn" onclick="createWorkspace()">Create Workspace</button>
</div>

<!-- Templates -->
<div class="presets-section">
  <span class="presets-toggle" onclick="document.getElementById('presets-panel').style.display=document.getElementById('presets-panel').style.display==='none'?'block':'none'">&#128203; Templates</span>
  <div id="presets-panel" style="display:none">
    <div class="presets-grid" id="presets-grid"><span class="muted" style="font-size:0.78rem">Loading...</span></div>
    <button class="btn btn-sm" style="background:#30363d;color:#c9d1d9;margin-bottom:0.5rem" onclick="showSavePresetForm()">+ Save New Template</button>
    <div class="save-preset-form" id="save-preset-form">
      <div class="form-row"><label>Name</label><input id="sp-name" placeholder="e.g. Python Dev"></div>
      <div class="form-row"><label>Description</label><input id="sp-desc" placeholder="optional"></div>
      <div class="form-row"><label>Repo URL</label><input id="sp-repo" placeholder="github.com/org/repo" style="width:280px"></div>
      <div class="form-row"><label>CPU req/lim</label><input id="sp-rcpu" value="4" style="width:60px"> / <input id="sp-lcpu" value="24" style="width:60px"></div>
      <div class="form-row"><label>Mem req/lim</label><input id="sp-rmem" value="8Gi" style="width:60px"> / <input id="sp-lmem" value="64Gi" style="width:60px"></div>
      <div class="form-row">
        <button class="btn btn-blue btn-sm" onclick="savePreset()">Save Template</button>
        <button class="btn btn-sm" style="background:var(--border2);color:var(--text);margin-left:4px" onclick="hideSavePresetForm()">Cancel</button>
      </div>
    </div>
  </div>
</div>

<table>
  <thead><tr><th><input type="checkbox" id="select-all" onchange="toggleSelectAll(this)"></th><th>Status</th><th>Workspace</th><th>Repo</th><th>URL</th><th>Resources</th><th>Usage</th><th>Auto-Shutdown</th><th>Actions</th></tr></thead>
  <tbody>
    {ws_rows if ws_rows else '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--muted)">No workspaces</td></tr>'}
  </tbody>
</table>

<!-- Bulk action bar -->
<div class="bulk-bar" id="bulk-bar">
  <span class="bulk-count" id="bulk-count">0 selected</span>
  <button class="btn btn-red btn-sm" onclick="bulkAction('stop')">Stop Selected</button>
  <button class="btn btn-green btn-sm" onclick="bulkAction('start')">Start Selected</button>
  <button class="btn btn-outline-red btn-sm" onclick="bulkAction('delete')">Delete Selected</button>
</div>

<!-- Resize popup (shared, positioned dynamically) -->
<div class="resize-popup" id="resize-popup">
  <div class="resize-grid">
    <div><label>CPU request</label><input id="rz-rcpu"></div>
    <div><label>CPU limit</label><input id="rz-lcpu"></div>
    <div><label>Mem request</label><input id="rz-rmem"></div>
    <div><label>Mem limit</label><input id="rz-lmem"></div>
  </div>
  <button class="btn btn-blue btn-sm" onclick="doResize()">Apply &amp; Restart</button>
  <button class="btn btn-sm" style="background:var(--border2);color:var(--text);margin-left:4px" onclick="hideResize()">Cancel</button>
  <input type="hidden" id="rz-pod"><input type="hidden" id="rz-uid">
</div>

<!-- Processes -->
<h2>Processes (top 30 by CPU)</h2>
<table class="proc-table">
  <thead><tr><th>PID</th><th>User</th><th>CPU%</th><th>MEM%</th><th>RES</th><th>Command</th></tr></thead>
  <tbody>{proc_rows}</tbody>
</table>"""

    return wrap_page("DevPod Dashboard", body, MAIN_PAGE_CSS, MAIN_PAGE_JS)
