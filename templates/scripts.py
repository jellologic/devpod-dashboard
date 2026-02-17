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
document.getElementById('repo').addEventListener('keydown',e=>{if(e.key==='Enter')createWorkspace()});
document.addEventListener('click',e=>{const p=document.getElementById('resize-popup');if(p.classList.contains('open')&&!p.contains(e.target)&&!e.target.classList.contains('btn-icon'))hideResize()});
let rt=setInterval(()=>location.reload(),10000);
document.addEventListener('mousedown',()=>clearInterval(rt));
document.addEventListener('mouseup',()=>{rt=setInterval(()=>location.reload(),10000)});
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

// Auto-refresh for detail page (slower)
let detailRefresh=setInterval(()=>location.reload(),15000);
document.addEventListener('mousedown',()=>clearInterval(detailRefresh));
document.addEventListener('mouseup',()=>{detailRefresh=setInterval(()=>location.reload(),15000)});
"""
