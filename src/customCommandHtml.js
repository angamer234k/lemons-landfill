function buildCustomCommandHtml() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>lemonAI · custom commands</title>
<style>
:root{color-scheme:dark;--bg:#0f0f10;--card:#1a1a1d;--border:#2a2a2e;--text:#e8e6e3;--muted:#888;--accent:#fdff94;--bad:#ed4245;--btn:#2b2d31}
*{box-sizing:border-box}body{font-family:ui-monospace,monospace;background:var(--bg);color:var(--text);margin:0;padding:1.25rem}
h1{color:var(--accent);margin:0}.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1rem;margin-bottom:.9rem}
button,.btn{background:var(--btn);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:.45rem .75rem;cursor:pointer;font:inherit;text-decoration:none;display:inline-block}
button.primary{background:#3a3a20;border-color:#6a6a30;color:var(--accent)}button.danger{border-color:#5a2a2a;color:#ffb4b4}
input,select,textarea{width:100%;background:#111;color:var(--text);border:1px solid var(--border);border-radius:8px;padding:.5rem;font:inherit;margin:.25rem 0 .6rem}
label{display:block;font-size:.8rem;color:var(--muted)}.row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
#app{display:none}.muted{color:var(--muted);font-size:.85rem}table{width:100%;border-collapse:collapse;font-size:.85rem}
th,td{text-align:left;padding:.4rem;border-bottom:1px solid var(--border)}code{background:#111;padding:0 .3rem;border-radius:4px}
.toast{position:fixed;bottom:1rem;right:1rem;background:#222;border:1px solid var(--border);padding:.6rem .9rem;border-radius:8px;display:none}
.toast.show{display:block}.toast.err{border-color:var(--bad)}
</style></head><body>
<div id="login" class="card"><h1>🍋 Custom commands</h1>
<p class="muted">Same NUDGE_SECRET as dashboard.</p>
<label>Secret</label><input id="secretInput" type="password"/>
<div class="row"><button class="primary" id="loginBtn">Unlock</button><a class="btn" href="/">← Dashboard</a></div>
<p class="muted" id="loginErr"></p></div>
<div id="app">
<div class="row" style="justify-content:space-between;margin-bottom:1rem">
<div><h1>🍋 Custom command builder</h1><p class="muted">Create slash commands with fixed replies.</p></div>
<div class="row"><a class="btn" href="/">Dashboard</a><button class="danger" id="logoutBtn">Logout</button></div>
</div>
<div class="card"><h2 style="color:var(--muted);font-size:.75rem">CREATE / EDIT</h2>
<input type="hidden" id="editId"/>
<label>Name</label><input id="ccName" maxlength="32" placeholder="hello"/>
<label>Description</label><input id="ccDesc" maxlength="100"/>
<label>Type</label><select id="ccType"><option value="plain">plain</option><option value="embed">embed</option></select>
<label>Response</label><textarea id="ccBody" rows="4"></textarea>
<label><input id="ccEnabled" type="checkbox" checked style="width:auto"/> Enabled</label>
<div class="row"><button class="primary" id="saveCcBtn">Save</button><button id="resetCcBtn">Clear</button><button id="reregisterBtn">Re-register slash cmds</button></div>
</div>
<div class="card"><h2 style="color:var(--muted);font-size:.75rem">EXISTING</h2><div id="ccList" class="muted">…</div></div>
</div>
<div class="toast" id="toast"></div>
<script>
const STORAGE_KEY='lemonai_nudge_secret';
const $=id=>document.getElementById(id);
let secret=localStorage.getItem(STORAGE_KEY)||'';
function toast(msg,err){const el=$('toast');el.textContent=msg;el.className='toast show'+(err?' err':'');setTimeout(()=>el.className='toast',2800)}
async function api(path,opts={}){const headers=Object.assign({'Content-Type':'application/json'},opts.headers||{});if(secret)headers['x-nudge-secret']=secret;const res=await fetch(path,{...opts,headers});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||res.statusText);return data}
function resetForm(){$('editId').value='';$('ccName').value='';$('ccName').disabled=false;$('ccDesc').value='';$('ccType').value='plain';$('ccBody').value='';$('ccEnabled').checked=true}
function fillForm(c){$('editId').value=c.id;$('ccName').value=c.name;$('ccName').disabled=true;$('ccDesc').value=c.description||'';$('ccType').value=c.responseType||'plain';$('ccBody').value=c.response||'';$('ccEnabled').checked=c.enabled!==false}
async function loadList(){const data=await api('/api/custom-commands');const list=data.commands||[];if(!list.length){$('ccList').innerHTML='No custom commands yet.';return}
$('ccList').innerHTML='<table><thead><tr><th>Name</th><th>Type</th><th></th></tr></thead><tbody>'+list.map(c=>'<tr><td><code>/'+c.name+'</code></td><td>'+c.responseType+'</td><td class="row"><button data-edit="'+c.id+'">Edit</button><button class="danger" data-del="'+c.id+'">Del</button></td></tr>').join('')+'</tbody></table>';
$('ccList').querySelectorAll('[data-edit]').forEach(btn=>btn.onclick=()=>{const c=list.find(x=>x.id===btn.dataset.edit);if(c)fillForm(c)});
$('ccList').querySelectorAll('[data-del]').forEach(btn=>btn.onclick=async()=>{if(!confirm('Delete?'))return;await api('/api/custom-commands/'+btn.dataset.del,{method:'DELETE'});toast('Deleted');resetForm();loadList()})}
async function tryLogin(s){secret=s;await api('/api/custom-commands');localStorage.setItem(STORAGE_KEY,secret);$('login').style.display='none';$('app').style.display='block';await loadList()}
$('loginBtn').onclick=async()=>{try{await tryLogin($('secretInput').value.trim())}catch(e){$('loginErr').textContent=e.message}};
$('logoutBtn').onclick=()=>{localStorage.removeItem(STORAGE_KEY);secret='';$('app').style.display='none';$('login').style.display='block'};
$('resetCcBtn').onclick=resetForm;
$('saveCcBtn').onclick=async()=>{try{const payload={name:$('ccName').value.trim(),description:$('ccDesc').value.trim(),responseType:$('ccType').value,response:$('ccBody').value,enabled:$('ccEnabled').checked};const id=$('editId').value;if(id)await api('/api/custom-commands/'+id,{method:'PATCH',body:JSON.stringify(payload)});else await api('/api/custom-commands',{method:'POST',body:JSON.stringify(payload)});toast('Saved');resetForm();await loadList()}catch(e){toast(e.message,true)}};
$('reregisterBtn').onclick=async()=>{try{const r=await api('/api/custom-commands/reregister',{method:'POST',body:'{}'});toast('Registered '+(r.count??'?')+' cmds')}catch(e){toast(e.message,true)}};
if(secret)tryLogin(secret).catch(()=>{localStorage.removeItem(STORAGE_KEY);secret=''});
</script></body></html>`;
}
module.exports = { buildCustomCommandHtml };
