"""All CSS as string constants."""

COMMON_CSS = """\
:root { --bg:#0d1117; --card:#161b22; --border:#21262d; --border2:#30363d;
         --text:#e1e4e8; --muted:#8b949e; --link:#58a6ff; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
       background:var(--bg); color:var(--text); padding:1.25rem 1.5rem; font-size:14px; }
h1 { font-size:1.4rem; font-weight:600; margin-bottom:0.15rem; }
h2 { font-size:1rem; font-weight:600; margin:1.25rem 0 0.5rem; color:var(--muted); }
.subtitle { color:var(--muted); font-size:0.8rem; margin-bottom:1rem; }
.muted { color:#484f58; }
a { color:var(--link); text-decoration:none; }
a:hover { text-decoration:underline; }

.btn { padding:0.3rem 0.7rem; border:none; border-radius:6px; cursor:pointer;
       font-size:0.78rem; font-weight:500; transition:opacity 0.15s; }
.btn:hover { opacity:0.85; }
.btn:disabled { opacity:0.4; cursor:not-allowed; }
.btn-red { background:#da3633; color:#fff; }
.btn-green { background:#238636; color:#fff; }
.btn-blue { background:#1f6feb; color:#fff; padding:0.45rem 0.9rem; font-size:0.85rem; }
.btn-sm { padding:0.25rem 0.5rem; font-size:0.72rem; }
.btn-outline-red { background:transparent; color:#f85149; border:1px solid #f8514966; }
.btn-outline-red:hover { background:#f8514920; }
.btn-confirm { background:#da3633; color:#fff; border:1px solid #da3633; animation:pulse 0.8s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.7} }
.btn-icon { background:none; border:none; color:var(--muted); cursor:pointer; font-size:0.85rem;
             padding:0 0.25rem; }
.btn-icon:hover { color:var(--link); }

table { width:100%; border-collapse:collapse; background:var(--card); border-radius:8px; overflow:hidden; }
th { text-align:left; padding:0.6rem 0.75rem; background:#1c2129; color:var(--muted);
     font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em; font-weight:500; }
td { padding:0.5rem 0.75rem; border-top:1px solid var(--border); font-size:0.82rem; vertical-align:middle; }
tr:hover td { background:#1c2129; }

.st-running { color:#3fb950; }
.st-stopped { color:#f85149; }
.st-creating { color:#d29922; }

.toast { position:fixed; bottom:1.5rem; right:1.5rem; background:var(--card);
         border:1px solid var(--border2); border-radius:8px; padding:0.7rem 1.1rem;
         font-size:0.85rem; display:none; z-index:100; box-shadow:0 4px 12px rgba(0,0,0,0.4); }
.toast.ok { border-color:#238636; }
.toast.err { border-color:#da3633; }
"""

MAIN_PAGE_CSS = """\
.sys { display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:1rem; }
.sys-card { background:var(--card); border-radius:8px; padding:0.75rem 1rem; }
.sys-card h3 { font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em;
                color:var(--muted); margin-bottom:0.5rem; font-weight:500; }
.cpu-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(64px,1fr)); gap:2px; }
.core { display:flex; align-items:center; gap:3px; font-size:0.65rem; color:var(--muted); }
.core-id { width:20px; text-align:right; flex-shrink:0; }
.core-bar { flex:1; height:8px; background:#21262d; border-radius:2px; overflow:hidden; }
.core-fill { height:100%; border-radius:2px; transition:width 0.3s; }
.cpu-overall { font-size:1.5rem; font-weight:600; margin-bottom:0.5rem; }
.cpu-overall span { font-size:0.8rem; color:var(--muted); font-weight:400; }
.metric { margin-bottom:0.5rem; }
.metric-label { display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:3px; }
.metric-label span:first-child { color:var(--muted); }
.bar { height:14px; background:#21262d; border-radius:3px; overflow:hidden; display:flex; }
.bar-seg { height:100%; transition:width 0.3s; }
.chips { display:flex; gap:1rem; flex-wrap:wrap; }
.chip { background:var(--card); border-radius:6px; padding:0.4rem 0.75rem; font-size:0.8rem; }
.chip .val { font-weight:600; }
.chip .lbl { color:var(--muted); font-size:0.7rem; }

/* Settings panel */
.settings-toggle { cursor:pointer; color:var(--link); font-size:0.82rem; font-weight:500;
                    display:inline-block; margin-bottom:0.5rem; }
.settings-panel { display:none; background:var(--card); border-radius:8px; padding:1rem;
                   margin-bottom:1rem; }
.settings-panel.open { display:block; }
.settings-row { display:flex; gap:0.75rem; align-items:center; margin-bottom:0.6rem; flex-wrap:wrap; }
.settings-row label { color:var(--muted); font-size:0.75rem; min-width:100px; }
.settings-row input { background:#0d1117; border:1px solid var(--border2); border-radius:4px;
                       color:var(--text); padding:0.3rem 0.5rem; font-size:0.8rem; width:80px; }
.settings-row .sep { color:var(--muted); font-size:0.75rem; }
.settings-group { margin-bottom:0.75rem; border-bottom:1px solid var(--border); padding-bottom:0.75rem; }
.settings-group:last-child { border-bottom:none; margin-bottom:0; padding-bottom:0; }
.settings-group h4 { font-size:0.75rem; color:var(--muted); text-transform:uppercase;
                      letter-spacing:0.04em; margin-bottom:0.4rem; }
.settings-used { font-size:0.72rem; color:var(--muted); margin-left:0.5rem; }

.create-bar { display:flex; gap:0.5rem; margin:1rem 0; align-items:center; }
.create-bar input { background:var(--card); border:1px solid var(--border2); border-radius:6px;
                     color:#c9d1d9; padding:0.45rem 0.7rem; font-size:0.85rem; outline:none; }
.create-bar input:focus { border-color:var(--link); }
.create-bar input.repo { flex:1; min-width:200px; }
.create-bar input.ws-name { width:170px; }

.timer-display { font-size:0.78rem; color:var(--muted); margin-right:0.4rem; }
.timer-select { background:#21262d; color:#c9d1d9; border:1px solid var(--border2);
                 border-radius:4px; padding:0.15rem 0.25rem; font-size:0.72rem; cursor:pointer; }
.res-display { font-size:0.78rem; font-family:'SF Mono',Menlo,monospace; }
.repo-link { font-size:0.75rem; max-width:200px; display:inline-block; overflow:hidden;
              text-overflow:ellipsis; white-space:nowrap; vertical-align:middle; }

.resize-popup { display:none; position:absolute; background:var(--card); border:1px solid var(--border2);
                 border-radius:8px; padding:0.75rem; z-index:50; box-shadow:0 4px 16px rgba(0,0,0,0.5); }
.resize-popup.open { display:block; }
.resize-popup label { font-size:0.7rem; color:var(--muted); display:block; margin-bottom:2px; }
.resize-popup input { background:#0d1117; border:1px solid var(--border2); border-radius:4px;
                       color:var(--text); padding:0.25rem 0.4rem; font-size:0.78rem; width:70px;
                       margin-bottom:0.4rem; }
.resize-grid { display:grid; grid-template-columns:1fr 1fr; gap:0.3rem 0.75rem; margin-bottom:0.5rem; }

.proc-table { font-size:0.78rem; }
.proc-table th { font-size:0.65rem; padding:0.4rem 0.6rem; }
.proc-table td { padding:0.3rem 0.6rem; font-family:'SF Mono',Menlo,monospace; font-size:0.72rem; }
.proc-table .num { text-align:right; }
.proc-table .cmd { max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.ws-name-link { color:var(--link); text-decoration:none; font-weight:600; }
.ws-name-link:hover { text-decoration:underline; }

.usage-display { font-size:0.78rem; font-family:'SF Mono',Menlo,monospace; }
.usage-cpu { color:#d29922; }
.usage-mem { color:#1f6feb; }
"""

DETAIL_PAGE_CSS = """\
.breadcrumb { font-size:0.8rem; color:var(--muted); margin-bottom:0.75rem; }
.breadcrumb a { color:var(--link); }

.detail-header { display:flex; align-items:center; gap:1rem; margin-bottom:1rem; flex-wrap:wrap; }
.detail-header h1 { margin-bottom:0; }
.status-badge { display:inline-block; padding:0.2rem 0.6rem; border-radius:12px;
                font-size:0.75rem; font-weight:500; }
.status-badge.running { background:#238636; color:#fff; }
.status-badge.stopped { background:#da3633; color:#fff; }
.status-badge.creating { background:#d29922; color:#fff; }
.detail-actions { display:flex; gap:0.5rem; margin-left:auto; }

.cards { display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:1rem; }
.card { background:var(--card); border-radius:8px; padding:0.75rem 1rem; }
.card h3 { font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em;
            color:var(--muted); margin-bottom:0.5rem; font-weight:500; }
.card-full { grid-column:1 / -1; }
.kv { display:grid; grid-template-columns:auto 1fr; gap:0.2rem 1rem; font-size:0.82rem; }
.kv dt { color:var(--muted); font-size:0.75rem; }
.kv dd { font-family:'SF Mono',Menlo,monospace; font-size:0.8rem; }

.log-viewer { background:#0d1117; border:1px solid var(--border2); border-radius:6px;
              padding:0.75rem; font-family:'SF Mono',Menlo,monospace; font-size:0.72rem;
              max-height:500px; overflow-y:auto; white-space:pre-wrap; word-break:break-all;
              color:#c9d1d9; line-height:1.5; }
.log-controls { display:flex; gap:0.5rem; margin-bottom:0.5rem; align-items:center; }
.log-status { font-size:0.75rem; color:var(--muted); }

.event-table { font-size:0.78rem; }
.event-table th { font-size:0.65rem; padding:0.4rem 0.6rem; }
.event-table td { padding:0.3rem 0.6rem; font-size:0.75rem; }
.event-type-warning { color:#d29922; }
.event-type-normal { color:#3fb950; }
"""
