function buildDashboardHtml() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>lemonAI · dashboard</title>
<style>
:root{color-scheme:dark;--bg:#0f0f10;--card:#1a1a1d;--border:#2a2a2e;--text:#e8e6e3;--muted:#888;--accent:#fdff94;--good:#3ba55d;--bad:#ed4245;--btn:#2b2d31}
*{box-sizing:border-box}body{font-family:ui-monospace,monospace;background:var(--bg);color:var(--text);margin:0;padding:1.25rem}
h1{color:var(--accent);margin:0}h2{margin:0 0 .75rem;font-size:.75rem;text-transform:uppercase;color:var(--muted);letter-spacing:.08em}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:.9rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1rem}.big{font-size:1.5rem;font-weight:700}
.online{color:var(--good)}.offline{color:var(--bad)}.muted{color:var(--muted);font-size:.85rem}
.row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
button,.btn{background:var(--btn);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:.45rem .75rem;cursor:pointer;font:inherit;text-decoration:none;display:inline-block}
button.primary{background:#3a3a20;border-color:#6a6a30;color:var(--accent)}button.danger{border-color:#5a2a2a;color:#ffb4b4}
input,select,textarea{width:100%;background:#111;color:var(--text);border:1px solid var(--border);border-radius:8px;padding:.5rem;font:inherit;margin:.25rem 0 .6rem}
label{display:block;font-size:.8rem;color:var(--muted)}#login{max-width:420px;margin:10vh auto}#app{display:none}
.toast{position:fixed;bottom:1rem;right:1rem;background:#222;border:1px solid var(--border);padding:.6rem .9rem;border-radius:8px;display:none}
.toast.show{display:block}.toast.err{border-color:var(--bad)}.chip{background:#111;border:1px solid var(--border);border-radius:999px;padding:.1rem .5rem;font-size:.75rem}
.cmds{display:flex;flex-wrap:wrap;gap:.35rem}
</style></head><body>
<div id="login" class="card"><h1>🍋 lemonAI</h1><p class="muted">Enter the nudge secret.</p>
<label>Secret</label><input id="secretInput" type="password"/>
<div class="row"><button class="primary" id="loginBtn">Unlock</button></div><p class="muted" id="loginErr"></p></div>
<div id="app">
<div class="row" style="justify-content:space-between;margin-bottom:1rem">
<div><h1>🍋 lemonAI dashboard</h1><p class="muted" id="subtitle">…</p></div>
<div class="row"><a class="btn" href="/cc">Custom commands</a><button id="refreshBtn">Refresh</button><button class="danger" id="logoutBtn">Logout</button></div>
</div>
<div class="grid">
<div class="card"><h2>Host</h2><div class="big" id="hostStatus">—</div><p class="muted" id="hostDescText"></p>
<p>Today: <strong id="hostToday">—</strong> · 3d: <strong id="host3d">—</strong></p>
<button class="primary" id="checkHostBtn">Force presence check</button></div>
<div class="card"><h2>Bot</h2><p>Uptime <strong id="botUptime">—</strong> · Ping <strong id="botPing">—</strong></p>
<p>Guilds <strong id="botGuilds">—</strong> · Cmds <strong id="botCmds">—</strong></p><div class="cmds" id="cmdList"></div></div>
<div class="card"><h2>Bot presence</h2>
<label>Status</label><select id="presStatus"><option>online</option><option selected>idle</option><option>dnd</option><option>invisible</option></select>
<label>Type</label><select id="presType"><option value="custom">custom</option><option>playing</option><option>listening</option><option>watching</option><option>competing</option></select>
<label>Text</label><input id="presName" maxlength="128"/>
<button class="primary" id="savePresBtn">Save presence</button></div>
<div class="card"><h2>AI config</h2>
<label>Provider</label><select id="aiProvider"></select>
<label>Model</label><input id="aiModel"/>
<label>Max replies</label><input id="aiMaxReplies" type="number" min="1" max="50"/>
<label><input id="aiAllowOthers" type="checkbox" style="width:auto"/> Allow others</label>
<button class="primary" id="saveAiBtn">Save AI</button></div>
<div class="card"><h2>Host description</h2>
<textarea id="hostDescInput" maxlength="500"></textarea>
<button class="primary" id="saveHostDescBtn">Save + refresh embed</button></div>
</div></div>
<div class="toast" id="toast"></div>
<script>
const K='lemonai_nudge_secret';const $=id=>document.getElementById(id);let secret=localStorage.getItem(K)||'';
function toast(m,e){const el=$('toast');el.textContent=m;el.className='toast show'+(e?' err':'');setTimeout(()=>el.className='toast',2800)}
async function api(path,opts={}){const h=Object.assign({'Content-Type':'application/json'},opts.headers||{});if(secret)h['x-nudge-secret']=secret;const r=await fetch(path,{...opts,headers:h});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||r.statusText);return d}
function render(i){
$('hostStatus').textContent=i.host.online?'ONLINE':'OFFLINE';$('hostStatus').className='big '+(i.host.online?'online':'offline');
$('hostDescText').textContent=i.host.description||'';$('hostToday').textContent=i.host.today.uptimePercent+'%';$('host3d').textContent=i.host.last3d.uptimePercent+'%';
$('botUptime').textContent=i.bot.uptime;$('botPing').textContent=(i.bot.ping??'—')+'ms';$('botGuilds').textContent=i.bot.guilds;$('botCmds').textContent=i.bot.commandCount;
$('subtitle').textContent=(i.bot.tag||'bot')+' · auto-refresh 30s';
$('cmdList').innerHTML=(i.bot.commands||[]).map(c=>'<span class="chip">/'+c+'</span>').join('');
const s=$('aiProvider');if(!s.options.length)(i.ai.providers||[]).forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;s.appendChild(o)});
s.value=i.ai.provider;$('aiModel').value=i.ai.model;$('aiMaxReplies').value=i.ai.maxReplies;$('aiAllowOthers').checked=!!i.ai.allowOthersToReply;
$('hostDescInput').value=i.host.description||'';
if(i.presence){$('presStatus').value=i.presence.status||'idle';$('presType').value=i.presence.activityType||'custom';$('presName').value=i.presence.activityName||''}
}
async function load(){render(await api('/api/info'))}
async function tryLogin(s){secret=s;await api('/api/info');localStorage.setItem(K,secret);$('login').style.display='none';$('app').style.display='block';await load();setInterval(()=>load().catch(()=>{}),30000)}
$('loginBtn').onclick=async()=>{try{await tryLogin($('secretInput').value.trim())}catch(e){$('loginErr').textContent=e.message}};
$('logoutBtn').onclick=()=>{localStorage.removeItem(K);location.reload()};
$('refreshBtn').onclick=async()=>{try{await load();toast('Refreshed')}catch(e){toast(e.message,true)}};
$('checkHostBtn').onclick=async()=>{try{const r=await api('/api/presence/check',{method:'POST',body:'{}'});toast('Host '+(r.online?'ONLINE':'OFFLINE'));await load()}catch(e){toast(e.message,true)}};
$('saveAiBtn').onclick=async()=>{try{await api('/api/config',{method:'POST',body:JSON.stringify({provider:$('aiProvider').value,aiModel:$('aiModel').value.trim(),maxReplies:Number($('aiMaxReplies').value),allowOthersToReply:$('aiAllowOthers').checked})});toast('AI saved');await load()}catch(e){toast(e.message,true)}};
$('saveHostDescBtn').onclick=async()=>{try{await api('/api/host/description',{method:'POST',body:JSON.stringify({description:$('hostDescInput').value})});toast('Updated');await load()}catch(e){toast(e.message,true)}};
$('savePresBtn').onclick=async()=>{try{await api('/api/presence',{method:'POST',body:JSON.stringify({status:$('presStatus').value,activityType:$('presType').value,activityName:$('presName').value})});toast('Presence saved');await load()}catch(e){toast(e.message,true)}};
if(secret)tryLogin(secret).catch(()=>{localStorage.removeItem(K);secret=''});
</script></body></html>`;
}
module.exports = { buildDashboardHtml };
