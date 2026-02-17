"""JavaScript for main page and detail page."""

MAIN_PAGE_JS = """\
function showToast(m,ok){const t=document.getElementById('toast');t.textContent=m;t.className='toast '+(ok?'ok':'err');t.style.display='block';setTimeout(()=>t.style.display='none',4000)}

async function doAction(a,p){const b=event.target,o=b.textContent;b.disabled=true;b.textContent=a==='stop'?'Stopping...':'Starting...';try{const r=await fetch('/api/'+a,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pod:p})});const d=await r.json();showToast(d.message,d.ok);if(d.ok)setTimeout(()=>location.reload(),2000);else{b.disabled=false;b.textContent=o}}catch(e){showToast('Failed',false);b.disabled=false;b.textContent=o}}

async function setTimer(p,h){try{const r=await fetch('/api/timer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pod:p,hours:parseFloat(h)})});const d=await r.json();showToast(d.message,d.ok);if(d.ok)setTimeout(()=>location.reload(),1000)}catch(e){showToast('Failed',false)}}

async function createWorkspace(){const repo=document.getElementById('repo').value.trim();const name=document.getElementById('ws-name').value.trim();if(!repo){showToast('Enter a repository URL',false);return}const b=document.getElementById('create-btn');b.disabled=true;b.textContent='Creating...';try{const r=await fetch('/api/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repo:repo,name:name})});const d=await r.json();showToast(d.message,d.ok);if(d.ok){document.getElementById('repo').value='';document.getElementById('ws-name').value='';setTimeout(()=>location.reload(),2000)}b.disabled=false;b.textContent='Create Workspace'}catch(e){showToast('Failed',false);b.disabled=false;b.textContent='Create Workspace'}}

function confirmDelete(btn,name,pod,uid){
  if(btn.dataset.armed){doDelete(btn,name,pod,uid);return}
  btn.dataset.armed='1';btn.textContent='Confirm?';btn.className='btn btn-confirm';
  setTimeout(()=>{if(btn.dataset.armed){delete btn.dataset.armed;btn.textContent='Delete';btn.className='btn btn-outline-red'}},3000);
}
async function doDelete(btn,name,pod,uid){
  btn.disabled=true;btn.textContent='Deleting...';
  try{const r=await fetch('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,pod:pod,uid:uid})});const d=await r.json();showToast(d.message,d.ok);if(d.ok)setTimeout(()=>location.reload(),2000);else{btn.disabled=false;btn.textContent='Delete';btn.className='btn btn-outline-red';delete btn.dataset.armed}}catch(e){showToast('Failed',false);btn.disabled=false;btn.textContent='Delete';btn.className='btn btn-outline-red';delete btn.dataset.armed}
}

function showResize(btn,pod,uid,rcpu,rmem,lcpu,lmem){
  const popup=document.getElementById('resize-popup');
  document.getElementById('rz-rcpu').value=rcpu;
  document.getElementById('rz-rmem').value=rmem;
  document.getElementById('rz-lcpu').value=lcpu;
  document.getElementById('rz-lmem').value=lmem;
  document.getElementById('rz-pod').value=pod;
  document.getElementById('rz-uid').value=uid;
  const rect=btn.getBoundingClientRect();
  popup.style.top=(rect.bottom+window.scrollY+4)+'px';
  popup.style.left=Math.min(rect.left,window.innerWidth-280)+'px';
  popup.classList.add('open');
}
function hideResize(){document.getElementById('resize-popup').classList.remove('open')}
async function doResize(){
  const pod=document.getElementById('rz-pod').value;
  const uid=document.getElementById('rz-uid').value;
  const body={pod:pod,uid:uid,req_cpu:document.getElementById('rz-rcpu').value,
    req_mem:document.getElementById('rz-rmem').value,lim_cpu:document.getElementById('rz-lcpu').value,
    lim_mem:document.getElementById('rz-lmem').value};
  hideResize();showToast('Resizing (will restart)...',true);
  try{const r=await fetch('/api/resize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();showToast(d.message,d.ok);if(d.ok)setTimeout(()=>location.reload(),3000)}catch(e){showToast('Failed',false)}
}

async function saveProvider(){
  const body={req_cpu:document.getElementById('s-prov-rcpu').value,req_mem:document.getElementById('s-prov-rmem').value,
    lim_cpu:document.getElementById('s-prov-lcpu').value,lim_mem:document.getElementById('s-prov-lmem').value};
  try{const r=await fetch('/api/settings/provider',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();showToast(d.message,d.ok)}catch(e){showToast('Failed',false)}
}
async function saveLimitRange(){
  const body={max_cpu:document.getElementById('s-lr-mcpu').value,max_mem:document.getElementById('s-lr-mmem').value,
    def_req_cpu:document.getElementById('s-lr-drcpu').value,def_req_mem:document.getElementById('s-lr-drmem').value};
  try{const r=await fetch('/api/settings/limitrange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();showToast(d.message,d.ok)}catch(e){showToast('Failed',false)}
}
async function saveQuota(){
  const body={req_cpu:document.getElementById('s-q-cpu').value,req_mem:document.getElementById('s-q-mem').value,
    pods:document.getElementById('s-q-pods').value};
  try{const r=await fetch('/api/settings/quota',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();showToast(d.message,d.ok)}catch(e){showToast('Failed',false)}
}

function promptDuplicate(name,pod,repo){
  const newName=prompt('New workspace name (duplicate of '+name+'):',name+'-copy');
  if(!newName)return;
  showToast('Duplicating '+name+'...',true);
  fetch('/api/duplicate',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:name,pod:pod,repo:repo,new_name:newName})})
    .then(r=>r.json()).then(d=>{showToast(d.message,d.ok);if(d.ok)setTimeout(()=>location.reload(),2000)})
    .catch(()=>showToast('Failed',false));
}
// Presets
async function loadPresets(){
  try{const r=await fetch('/api/presets');const presets=await r.json();
  const grid=document.getElementById('presets-grid');
  if(!presets.length){grid.innerHTML='<span class="muted" style="font-size:0.78rem">No templates saved yet</span>';return}
  grid.innerHTML='';
  presets.forEach(p=>{
    const card=document.createElement('div');card.className='preset-card';
    card.innerHTML='<div class="preset-name">'+p.name+'</div>'+
      (p.description?'<div class="preset-desc">'+p.description+'</div>':'')+
      '<div class="preset-meta">'+p.lim_cpu+'c / '+p.lim_mem+'</div>'+
      '<button class="preset-del" onclick="event.stopPropagation();deletePreset(\''+p.id+'\')" title="Delete template">&times;</button>';
    card.onclick=function(){usePreset(p.id,p.repo_url)};
    grid.appendChild(card);
  });
  }catch(e){console.error('loadPresets',e)}
}
function usePreset(id,repo){
  const name=prompt('Workspace name (optional):','');
  if(name===null)return;
  showToast('Creating from template...',true);
  fetch('/api/create-from-preset',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:id,name:name})}).then(r=>r.json()).then(d=>{showToast(d.message,d.ok);if(d.ok)setTimeout(()=>location.reload(),2000)}).catch(()=>showToast('Failed',false));
}
async function deletePreset(id){
  if(!confirm('Delete this template?'))return;
  try{const r=await fetch('/api/presets/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})});
  const d=await r.json();showToast(d.message,d.ok);loadPresets()}catch(e){showToast('Failed',false)}
}
function showSavePresetForm(){document.getElementById('save-preset-form').classList.add('open')}
function hideSavePresetForm(){document.getElementById('save-preset-form').classList.remove('open')}
async function savePreset(){
  const body={name:document.getElementById('sp-name').value.trim(),
    description:document.getElementById('sp-desc').value.trim(),
    repo_url:document.getElementById('sp-repo').value.trim(),
    req_cpu:document.getElementById('sp-rcpu').value,req_mem:document.getElementById('sp-rmem').value,
    lim_cpu:document.getElementById('sp-lcpu').value,lim_mem:document.getElementById('sp-lmem').value};
  if(!body.name||!body.repo_url){showToast('Name and repo URL required',false);return}
  try{const r=await fetch('/api/presets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json();showToast(d.message,d.ok);if(d.ok){hideSavePresetForm();loadPresets()}}catch(e){showToast('Failed',false)}
}

function toggleSelectAll(el){document.querySelectorAll('.ws-check').forEach(c=>{c.checked=el.checked});updateBulkBar()}
function updateBulkBar(){const checked=document.querySelectorAll('.ws-check:checked');const bar=document.getElementById('bulk-bar');const cnt=document.getElementById('bulk-count');if(checked.length>0){bar.classList.add('visible');cnt.textContent=checked.length+' selected'}else{bar.classList.remove('visible')}}
async function bulkAction(action){
  const checked=document.querySelectorAll('.ws-check:checked');
  if(!checked.length)return;
  if(action==='delete'&&!confirm('Delete '+checked.length+' workspace(s)? This cannot be undone.'))return;
  const bar=document.getElementById('bulk-bar');
  bar.querySelectorAll('button').forEach(b=>{b.disabled=true});
  try{
    if(action==='delete'){
      const workspaces=[];checked.forEach(c=>workspaces.push({name:c.dataset.name,pod:c.dataset.pod,uid:c.dataset.uid}));
      const r=await fetch('/api/bulk/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspaces:workspaces})});
      const d=await r.json();showToast(d.message,d.ok);
    }else{
      const pods=[];checked.forEach(c=>pods.push(c.dataset.pod));
      const r=await fetch('/api/bulk/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pods:pods})});
      const d=await r.json();showToast(d.message,d.ok);
    }
    setTimeout(()=>location.reload(),2000);
  }catch(e){showToast('Bulk action failed',false)}
}

// Expiry settings (Feature 5)
async function loadExpiry(){
  try{const r=await fetch('/api/expiry');const d=await r.json();
  const el=document.getElementById('s-expiry-days');
  if(el)el.value=d.days||0;
  }catch(e){}
}
async function saveExpiry(){
  const days=parseInt(document.getElementById('s-expiry-days').value)||0;
  try{const r=await fetch('/api/expiry',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({days:days})});
  const d=await r.json();showToast(d.message,d.ok)}catch(e){showToast('Failed',false)}
}

document.getElementById('repo').addEventListener('keydown',e=>{if(e.key==='Enter')createWorkspace()});
document.addEventListener('click',e=>{const p=document.getElementById('resize-popup');if(p.classList.contains('open')&&!p.contains(e.target)&&!e.target.classList.contains('btn-icon'))hideResize()});
let rt=setInterval(()=>location.reload(),10000);
document.addEventListener('mousedown',()=>clearInterval(rt));
document.addEventListener('mouseup',()=>{rt=setInterval(()=>location.reload(),10000)});
loadPresets();
loadExpiry();
"""

DETAIL_PAGE_JS = """\
function showToast(m,ok){const t=document.getElementById('toast');t.textContent=m;t.className='toast '+(ok?'ok':'err');t.style.display='block';setTimeout(()=>t.style.display='none',4000)}

async function doAction(a,p){const b=event.target,o=b.textContent;b.disabled=true;b.textContent=a==='stop'?'Stopping...':'Starting...';try{const r=await fetch('/api/'+a,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pod:p})});const d=await r.json();showToast(d.message,d.ok);if(d.ok)setTimeout(()=>location.reload(),2000);else{b.disabled=false;b.textContent=o}}catch(e){showToast('Failed',false);b.disabled=false;b.textContent=o}}

function confirmDelete(btn,name,pod,uid){
  if(btn.dataset.armed){doDelete(btn,name,pod,uid);return}
  btn.dataset.armed='1';btn.textContent='Confirm?';btn.className='btn btn-confirm';
  setTimeout(()=>{if(btn.dataset.armed){delete btn.dataset.armed;btn.textContent='Delete';btn.className='btn btn-outline-red'}},3000);
}
async function doDelete(btn,name,pod,uid){
  btn.disabled=true;btn.textContent='Deleting...';
  try{const r=await fetch('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,pod:pod,uid:uid})});const d=await r.json();showToast(d.message,d.ok);if(d.ok)setTimeout(()=>window.location='/',2000);else{btn.disabled=false;btn.textContent='Delete';btn.className='btn btn-outline-red';delete btn.dataset.armed}}catch(e){showToast('Failed',false);btn.disabled=false;btn.textContent='Delete';btn.className='btn btn-outline-red';delete btn.dataset.armed}
}

function promptDuplicate(name,pod,repo){
  const newName=prompt('New workspace name (duplicate of '+name+'):',name+'-copy');
  if(!newName)return;
  showToast('Duplicating '+name+'...',true);
  fetch('/api/duplicate',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:name,pod:pod,repo:repo,new_name:newName})})
    .then(r=>r.json()).then(d=>{showToast(d.message,d.ok);if(d.ok)setTimeout(()=>window.location='/',2000)})
    .catch(()=>showToast('Failed',false));
}

// Save as template
async function saveAsTemplate(name,repo,rcpu,rmem,lcpu,lmem){
  const tplName=prompt('Template name:',name+' template');
  if(!tplName)return;
  const desc=prompt('Description (optional):','');
  if(desc===null)return;
  try{const r=await fetch('/api/presets',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:tplName,description:desc,repo_url:repo,req_cpu:rcpu,req_mem:rmem,lim_cpu:lcpu,lim_mem:lmem})});
  const d=await r.json();showToast(d.message,d.ok)}catch(e){showToast('Failed',false)}
}

// Terminal
let termWs=null,termObj=null,termFit=null;
function connectTerminal(podName){
  if(termWs){disconnectTerminal();return}
  const proto=location.protocol==='https:'?'wss:':'ws:';
  const url=proto+'//'+location.host+'/api/terminal/'+encodeURIComponent(podName);
  const statusEl=document.getElementById('term-status');
  const connectBtn=document.getElementById('term-connect-btn');
  const disconnectBtn=document.getElementById('term-disconnect-btn');
  statusEl.textContent='Connecting...';
  termWs=new WebSocket(url);
  termWs.binaryType='arraybuffer';
  termObj=new Terminal({cursorBlink:true,fontSize:13,theme:{background:'#0d1117',foreground:'#e1e4e8'}});
  termFit=new FitAddon.FitAddon();
  termObj.loadAddon(termFit);
  termObj.open(document.getElementById('terminal-container'));
  termFit.fit();
  termObj.onData(function(data){if(termWs&&termWs.readyState===1){termWs.send(new TextEncoder().encode(data))}});
  termWs.onopen=function(){statusEl.textContent='Connected';connectBtn.style.display='none';disconnectBtn.style.display='';
    // Pause auto-refresh while terminal is open
    clearInterval(detailRefresh);
  };
  termWs.onmessage=function(e){
    if(e.data instanceof ArrayBuffer){termObj.write(new Uint8Array(e.data))}
    else{termObj.write(e.data)}
  };
  termWs.onclose=function(){statusEl.textContent='Disconnected';connectBtn.style.display='';disconnectBtn.style.display='none';
    detailRefresh=setInterval(()=>location.reload(),15000);
  };
  termWs.onerror=function(){statusEl.textContent='Error';disconnectTerminal()};
  window.addEventListener('resize',function(){if(termFit)try{termFit.fit()}catch(e){}});
}
function disconnectTerminal(){
  if(termWs){try{termWs.close()}catch(e){}}
  termWs=null;
  if(termObj){termObj.dispose();termObj=null}
  termFit=null;
  document.getElementById('terminal-container').innerHTML='';
  document.getElementById('term-connect-btn').style.display='';
  document.getElementById('term-disconnect-btn').style.display='none';
  document.getElementById('term-status').textContent='Disconnected';
}

// Schedules
async function loadSchedules(){
  if(typeof WS_NAME==='undefined')return;
  try{const r=await fetch('/api/schedules');const all=await r.json();
  const mine=all.filter(s=>s.workspace===WS_NAME);
  mine.forEach(s=>{
    const prefix=s.action==='start'?'start':'stop';
    const timeInput=document.getElementById('sched-'+prefix+'-time');
    if(timeInput)timeInput.value=String(s.hour).padStart(2,'0')+':'+String(s.minute).padStart(2,'0');
    (s.days||[]).forEach(d=>{
      const cb=document.getElementById('sched-'+prefix+'-'+d);
      if(cb)cb.checked=true;
    });
  });
  }catch(e){console.error('loadSchedules',e)}
}
async function saveSchedule(action){
  const prefix=action;
  const timeVal=document.getElementById('sched-'+prefix+'-time').value;
  if(!timeVal){showToast('Set a time first',false);return}
  const parts=timeVal.split(':');
  const days=[];
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d=>{
    const cb=document.getElementById('sched-'+prefix+'-'+d);
    if(cb&&cb.checked)days.push(d);
  });
  if(!days.length){showToast('Select at least one day',false);return}
  try{const r=await fetch('/api/schedule/set',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({workspace:WS_NAME,pod_name:POD_NAME,action:action,days:days,hour:parseInt(parts[0]),minute:parseInt(parts[1])})});
  const d=await r.json();showToast(d.message,d.ok)}catch(e){showToast('Failed',false)}
}
async function removeSchedule(action){
  try{const r=await fetch('/api/schedule/remove',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({workspace:WS_NAME,action:action})});
  const d=await r.json();showToast(d.message,d.ok);
  // Clear UI
  const prefix=action;
  document.getElementById('sched-'+prefix+'-time').value='';
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d=>{
    const cb=document.getElementById('sched-'+prefix+'-'+d);if(cb)cb.checked=false;
  });
  }catch(e){showToast('Failed',false)}
}

// Live log streaming via SSE
let evtSource=null;
function startLogStream(podName){
  const viewer=document.getElementById('log-content');
  const statusEl=document.getElementById('log-status');
  const btn=document.getElementById('log-stream-btn');
  if(evtSource){stopLogStream();return}
  evtSource=new EventSource('/api/logs/stream/'+encodeURIComponent(podName));
  btn.textContent='Stop streaming';btn.className='btn btn-red btn-sm';
  statusEl.textContent='Connected';
  evtSource.onmessage=function(e){
    viewer.textContent+=e.data+'\\n';
    viewer.scrollTop=viewer.scrollHeight;
  };
  evtSource.onerror=function(){
    statusEl.textContent='Disconnected';
    stopLogStream();
  };
}
function stopLogStream(){
  if(evtSource){evtSource.close();evtSource=null}
  const btn=document.getElementById('log-stream-btn');
  if(btn){btn.textContent='Start streaming';btn.className='btn btn-green btn-sm'}
}

// Creation log polling
let creationPoll=null;
function startCreationLogPoll(wsName){
  const viewer=document.getElementById('log-content');
  const statusEl=document.getElementById('log-status');
  statusEl.textContent='Polling...';
  creationPoll=setInterval(async()=>{
    try{
      const r=await fetch('/api/logs/creation/'+encodeURIComponent(wsName));
      const d=await r.json();
      if(d.lines){viewer.textContent=d.lines.join('\\n');viewer.scrollTop=viewer.scrollHeight}
      if(d.status){statusEl.textContent='Status: '+d.status}
      if(!d.creating){clearInterval(creationPoll);statusEl.textContent='Done';setTimeout(()=>location.reload(),3000)}
    }catch(e){statusEl.textContent='Poll error'}
  },2000);
}

// Usage history sparklines (Feature 3)
async function loadUsageHistory(podName){
  if(!podName)return;
  try{
    const r=await fetch('/api/usage-history/'+encodeURIComponent(podName));
    const data=await r.json();
    if(!data.length)return;
    const cpuData=data.map(d=>[d[0],d[1]]);
    const memData=data.map(d=>[d[0],d[2]]);
    renderSparkline('sparkline-cpu',cpuData,'#d29922','CPU','m');
    renderSparkline('sparkline-mem',memData,'#1f6feb','Memory','bytes');
  }catch(e){console.error('loadUsageHistory',e)}
}

function renderSparkline(svgId,data,color,label,unit){
  const svg=document.getElementById(svgId);
  if(!svg||!data.length)return;
  const W=200,H=40,pad=1;
  const vals=data.map(d=>d[1]);
  const minV=Math.min(...vals),maxV=Math.max(...vals);
  const range=maxV-minV||1;
  const points=data.map((d,i)=>{
    const x=pad+(i/(data.length-1||1))*(W-2*pad);
    const y=H-pad-((d[1]-minV)/range)*(H-2*pad);
    return x.toFixed(1)+','+y.toFixed(1);
  }).join(' ');
  // Fill polygon
  const firstX=(pad).toFixed(1);
  const lastX=(pad+((data.length-1)/(data.length-1||1))*(W-2*pad)).toFixed(1);
  const fillPts=firstX+','+H+' '+points+' '+lastX+','+H;
  svg.innerHTML='<polygon points="'+fillPts+'" fill="'+color+'" opacity="0.15"/>'+
    '<polyline points="'+points+'" fill="none" stroke="'+color+'" stroke-width="1.5" stroke-linejoin="round"/>';
  // Update value display
  const valEl=document.getElementById(svgId+'-val');
  const minEl=document.getElementById(svgId+'-min');
  const maxEl=document.getElementById(svgId+'-max');
  const last=vals[vals.length-1];
  if(valEl){
    if(unit==='bytes')valEl.textContent=formatBytes(last);
    else valEl.textContent=last+'m';
  }
  if(minEl){
    if(unit==='bytes')minEl.textContent='min: '+formatBytes(minV);
    else minEl.textContent='min: '+minV+'m';
  }
  if(maxEl){
    if(unit==='bytes')maxEl.textContent='max: '+formatBytes(maxV);
    else maxEl.textContent='max: '+maxV+'m';
  }
}

function formatBytes(b){
  if(b>=1073741824)return (b/1073741824).toFixed(1)+'Gi';
  if(b>=1048576)return (b/1048576).toFixed(0)+'Mi';
  if(b>=1024)return (b/1024).toFixed(0)+'Ki';
  return b+'B';
}

// Auto-refresh for detail page (slower)
let detailRefresh=setInterval(()=>location.reload(),15000);
document.addEventListener('mousedown',()=>clearInterval(detailRefresh));
document.addEventListener('mouseup',()=>{detailRefresh=setInterval(()=>location.reload(),15000)});
loadSchedules();
if(typeof POD_NAME!=='undefined'&&POD_NAME)loadUsageHistory(POD_NAME);
"""
