const http = require('http');
const os = require('os');
const { URL } = require('url');
const {
  OWNER_ID,
  NUDGE_SECRET,
  CHECK_INTERVAL_MS,
  botConfig,
  PROVIDER_DEFAULTS,
} = require('./config');
const roblox = require('./roblox');
const { getReminderCount, formatDuration } = require('./reminders');

function json(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-nudge-secret, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function getSecret(req, url) {
  const header =
    req.headers['x-nudge-secret'] ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const query = url.searchParams.get('secret');
  return header || query || null;
}

function requireSecret(req, url, res) {
  const secret = getSecret(req, url);
  if (secret !== NUDGE_SECRET) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}

function buildInfo(ctx) {
  const { client, startTime, commands } = ctx;
  const mem = process.memoryUsage();
  const dayStats = roblox.getUptimeStats(24 * 60 * 60 * 1000);
  const allStats = roblox.getUptimeStats(3 * 24 * 60 * 60 * 1000);
  const history = roblox.getHistory(24 * 60 * 60 * 1000);

  return {
    ok: true,
    bot: {
      tag: client.user?.tag || null,
      id: client.user?.id || null,
      ready: client.isReady?.() ?? !!client.user,
      uptimeMs: Date.now() - startTime,
      uptime: formatDuration(Date.now() - startTime),
      ping: client.ws?.ping ?? null,
      guilds: client.guilds?.cache?.size ?? 0,
      usersCached: client.users?.cache?.size ?? 0,
      commands: commands ? [...commands.keys()].sort() : [],
      commandCount: commands?.size ?? 0,
    },
    ai: {
      provider: botConfig.provider,
      model: botConfig.aiModel,
      maxReplies: botConfig.maxReplies,
      allowOthersToReply: botConfig.allowOthersToReply,
      providers: Object.keys(PROVIDER_DEFAULTS),
    },
    host: {
      online: roblox.currentIsOnline,
      description: roblox.getHostDescription(),
      checkIntervalMs: CHECK_INTERVAL_MS,
      today: {
        uptimePercent: Number(dayStats.uptimePercent.toFixed(1)),
        onlineChecks: dayStats.onlineChecks,
        totalChecks: dayStats.totalChecks,
        currentStreakMs: dayStats.currentStreakMs || 0,
        currentStreak: formatDuration(dayStats.currentStreakMs || 0),
        longestOnline: formatDuration(dayStats.longestOnlineMs || 0),
        longestOffline: formatDuration(dayStats.longestOfflineMs || 0),
      },
      last3d: {
        uptimePercent: Number(allStats.uptimePercent.toFixed(1)),
        onlineChecks: allStats.onlineChecks,
        totalChecks: allStats.totalChecks,
      },
      sparkline: history.map(e => (e.online ? 1 : 0)),
    },
    reminders: {
      pending: getReminderCount(),
    },
    system: {
      platform: os.platform(),
      arch: os.arch(),
      node: process.version,
      pid: process.pid,
      memory: {
        rssMB: Number((mem.rss / 1024 / 1024).toFixed(1)),
        heapUsedMB: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
        heapTotalMB: Number((mem.heapTotal / 1024 / 1024).toFixed(1)),
      },
      loadavg: os.loadavg().map(n => Number(n.toFixed(2))),
      freeMemMB: Number((os.freemem() / 1024 / 1024).toFixed(1)),
      totalMemMB: Number((os.totalmem() / 1024 / 1024).toFixed(1)),
    },
    timestamp: new Date().toISOString(),
  };
}

function buildDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>lemonAI · dashboard</title>
  <style>
    :root { color-scheme: dark; --bg:#0f0f10; --card:#1a1a1d; --border:#2a2a2e; --text:#e8e6e3; --muted:#888; --accent:#fdff94; --good:#3ba55d; --bad:#ed4245; --btn:#2b2d31; }
    * { box-sizing: border-box; }
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--bg); color: var(--text); margin: 0; padding: 1.25rem; line-height: 1.45; }
    h1 { color: var(--accent); margin: 0; font-size: 1.4rem; }
    h2 { margin: 0 0 0.75rem; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    .sub { color: var(--muted); margin: 0.25rem 0 1.25rem; font-size: 0.85rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.9rem; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1rem 1.1rem; }
    .big { font-size: 1.5rem; font-weight: 700; }
    .online { color: var(--good); }
    .offline { color: var(--bad); }
    .muted { color: var(--muted); font-size: 0.85rem; }
    .row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
    button, .btn {
      background: var(--btn); color: var(--text); border: 1px solid var(--border);
      border-radius: 8px; padding: 0.45rem 0.75rem; cursor: pointer; font: inherit;
    }
    button:hover { border-color: var(--accent); }
    button.primary { background: #3a3a20; border-color: #6a6a30; color: var(--accent); }
    button.danger { border-color: #5a2a2a; color: #ffb4b4; }
    input, select, textarea {
      width: 100%; background: #111; color: var(--text); border: 1px solid var(--border);
      border-radius: 8px; padding: 0.5rem 0.65rem; font: inherit; margin: 0.25rem 0 0.6rem;
    }
    textarea { min-height: 70px; resize: vertical; }
    label { display: block; font-size: 0.8rem; color: var(--muted); margin-top: 0.35rem; }
    .spark { letter-spacing: -1px; word-break: break-all; font-size: 0.85rem; line-height: 1.2; }
    .toast { position: fixed; bottom: 1rem; right: 1rem; background: #222; border: 1px solid var(--border); padding: 0.6rem 0.9rem; border-radius: 8px; display: none; z-index: 20; }
    .toast.show { display: block; }
    .toast.err { border-color: var(--bad); }
    #login { max-width: 420px; margin: 10vh auto; }
    #app { display: none; }
    .cmds { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .chip { background: #111; border: 1px solid var(--border); border-radius: 999px; padding: 0.15rem 0.55rem; font-size: 0.75rem; }
    .topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <div id="login" class="card">
    <h1>🍋 lemonAI</h1>
    <p class="sub">Enter the nudge secret once — saved in this browser.</p>
    <label>Secret</label>
    <input id="secretInput" type="password" placeholder="NUDGE_SECRET" autocomplete="current-password" />
    <div class="row">
      <button class="primary" id="loginBtn">Unlock dashboard</button>
    </div>
    <p class="muted" id="loginErr"></p>
  </div>

  <div id="app">
    <div class="topbar">
      <div>
        <h1>🍋 lemonAI dashboard</h1>
        <p class="sub" id="subtitle">loading…</p>
      </div>
      <div class="row">
        <button id="refreshBtn">Refresh</button>
        <button class="danger" id="logoutBtn">Logout</button>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>Host</h2>
        <div class="big" id="hostStatus">—</div>
        <p class="muted" id="hostDescText"></p>
        <p>Today: <strong id="hostToday">—</strong></p>
        <p>3d: <strong id="host3d">—</strong></p>
        <p>Streak: <strong id="hostStreak">—</strong></p>
        <p class="muted">Longest online/offline: <span id="hostLongest">—</span></p>
        <div class="spark" id="sparkline"></div>
        <div class="row" style="margin-top:0.75rem">
          <button class="primary" id="checkHostBtn">Force presence check</button>
        </div>
      </div>

      <div class="card">
        <h2>Bot</h2>
        <p>Uptime: <strong id="botUptime">—</strong></p>
        <p>Ping: <strong id="botPing">—</strong></p>
        <p>Guilds: <strong id="botGuilds">—</strong></p>
        <p>Commands: <strong id="botCmds">—</strong></p>
        <p>Reminders pending: <strong id="botReminders">—</strong></p>
        <div class="cmds" id="cmdList"></div>
      </div>

      <div class="card">
        <h2>System</h2>
        <p id="sysLine">—</p>
        <p>RSS: <strong id="sysRss">—</strong></p>
        <p>Heap: <strong id="sysHeap">—</strong></p>
        <p>Load: <strong id="sysLoad">—</strong></p>
        <p class="muted" id="sysTs"></p>
      </div>

      <div class="card">
        <h2>Edit AI config</h2>
        <p class="muted">Runtime only — resets on bot restart.</p>
        <label>Provider</label>
        <select id="aiProvider"></select>
        <label>Model</label>
        <input id="aiModel" />
        <label>Max replies</label>
        <input id="aiMaxReplies" type="number" min="1" max="50" />
        <label><input id="aiAllowOthers" type="checkbox" style="width:auto;margin-right:0.4rem" /> Allow others to reply in AI threads</label>
        <div class="row" style="margin-top:0.6rem">
          <button class="primary" id="saveAiBtn">Save AI config</button>
        </div>
      </div>

      <div class="card">
        <h2>Edit host description</h2>
        <p class="muted">Updates the live Discord status embed text (runtime).</p>
        <textarea id="hostDescInput" maxlength="500"></textarea>
        <div class="row">
          <button class="primary" id="saveHostDescBtn">Save + refresh embed</button>
        </div>
      </div>

      <div class="card">
        <h2>Actions</h2>
        <label>Send yourself a test DM</label>
        <input id="testDmInput" placeholder="hello from dashboard" />
        <div class="row">
          <button id="testDmBtn">Send test DM</button>
        </div>
        <label style="margin-top:1rem">Simulate site nudge</label>
        <input id="nudgeName" placeholder="Name" value="dashboard" />
        <textarea id="nudgeMsg" placeholder="Message from the site…"></textarea>
        <div class="row">
          <button id="nudgeBtn">Send nudge</button>
        </div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const STORAGE_KEY = 'lemonai_nudge_secret';
    const $ = (id) => document.getElementById(id);
    let secret = localStorage.getItem(STORAGE_KEY) || '';
    let refreshTimer = null;

    function toast(msg, isErr) {
      const el = $('toast');
      el.textContent = msg;
      el.className = 'toast show' + (isErr ? ' err' : '');
      setTimeout(() => { el.className = 'toast'; }, 2800);
    }

    async function api(path, opts = {}) {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      if (secret) headers['x-nudge-secret'] = secret;
      const res = await fetch(path, { ...opts, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || res.statusText || 'request failed');
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    }

    function spark(arr) {
      if (!arr || !arr.length) return 'No history yet';
      const max = 64;
      let pts = arr;
      if (arr.length > max) {
        const step = arr.length / max;
        pts = [];
        for (let i = 0; i < max; i++) pts.push(arr[Math.min(Math.floor(i * step), arr.length - 1)]);
      }
      return pts.map(v => v ? '█' : '░').join('');
    }

    function render(info) {
      const online = info.host.online;
      $('hostStatus').textContent = online ? 'ONLINE' : 'OFFLINE';
      $('hostStatus').className = 'big ' + (online ? 'online' : 'offline');
      $('hostDescText').textContent = info.host.description || '';
      $('hostToday').textContent = info.host.today.uptimePercent + '% (' + info.host.today.onlineChecks + '/' + info.host.today.totalChecks + ')';
      $('host3d').textContent = info.host.last3d.uptimePercent + '% (' + info.host.last3d.onlineChecks + '/' + info.host.last3d.totalChecks + ')';
      $('hostStreak').textContent = info.host.today.currentStreak + (online ? ' online' : ' offline');
      $('hostLongest').textContent = info.host.today.longestOnline + ' / ' + info.host.today.longestOffline;
      $('sparkline').textContent = spark(info.host.sparkline);

      $('botUptime').textContent = info.bot.uptime;
      $('botPing').textContent = (info.bot.ping ?? '—') + 'ms';
      $('botGuilds').textContent = info.bot.guilds;
      $('botCmds').textContent = info.bot.commandCount;
      $('botReminders').textContent = info.reminders.pending;
      $('subtitle').textContent = (info.bot.tag || 'bot') + ' · auto-refresh 30s';
      $('cmdList').innerHTML = (info.bot.commands || []).map(c => '<span class="chip">/' + c + '</span>').join('');

      $('sysLine').textContent = info.system.platform + '/' + info.system.arch + ' · ' + info.system.node + ' · pid ' + info.system.pid;
      $('sysRss').textContent = info.system.memory.rssMB + ' MB';
      $('sysHeap').textContent = info.system.memory.heapUsedMB + '/' + info.system.memory.heapTotalMB + ' MB';
      $('sysLoad').textContent = info.system.loadavg.join(' ');
      $('sysTs').textContent = info.timestamp;

      const sel = $('aiProvider');
      if (!sel.options.length) {
        (info.ai.providers || ['mistral', 'navy']).forEach(p => {
          const o = document.createElement('option');
          o.value = p; o.textContent = p; sel.appendChild(o);
        });
      }
      sel.value = info.ai.provider;
      $('aiModel').value = info.ai.model;
      $('aiMaxReplies').value = info.ai.maxReplies;
      $('aiAllowOthers').checked = !!info.ai.allowOthersToReply;
      $('hostDescInput').value = info.host.description || '';
    }

    async function load() {
      const info = await api('/api/info');
      render(info);
    }

    async function tryLogin(s) {
      secret = s;
      await api('/api/info');
      localStorage.setItem(STORAGE_KEY, secret);
      $('login').style.display = 'none';
      $('app').style.display = 'block';
      await load();
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(() => load().catch(() => {}), 30000);
    }

    $('loginBtn').onclick = async () => {
      $('loginErr').textContent = '';
      try {
        await tryLogin($('secretInput').value.trim());
      } catch (e) {
        $('loginErr').textContent = e.status === 401 ? 'Wrong secret.' : (e.message || 'Login failed');
      }
    };
    $('secretInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });

    $('logoutBtn').onclick = () => {
      localStorage.removeItem(STORAGE_KEY);
      secret = '';
      if (refreshTimer) clearInterval(refreshTimer);
      $('app').style.display = 'none';
      $('login').style.display = 'block';
      $('secretInput').value = '';
    };

    $('refreshBtn').onclick = async () => {
      try { await load(); toast('Refreshed'); } catch (e) { toast(e.message, true); }
    };

    $('checkHostBtn').onclick = async () => {
      try {
        const r = await api('/api/presence/check', { method: 'POST', body: '{}' });
        toast('Checked — host is ' + (r.online ? 'ONLINE' : 'OFFLINE'));
        await load();
      } catch (e) { toast(e.message, true); }
    };

    $('saveAiBtn').onclick = async () => {
      try {
        await api('/api/config', {
          method: 'POST',
          body: JSON.stringify({
            provider: $('aiProvider').value,
            aiModel: $('aiModel').value.trim(),
            maxReplies: Number($('aiMaxReplies').value),
            allowOthersToReply: $('aiAllowOthers').checked,
          }),
        });
        toast('AI config saved (runtime)');
        await load();
      } catch (e) { toast(e.message, true); }
    };

    $('saveHostDescBtn').onclick = async () => {
      try {
        await api('/api/host/description', {
          method: 'POST',
          body: JSON.stringify({ description: $('hostDescInput').value }),
        });
        toast('Host description updated');
        await load();
      } catch (e) { toast(e.message, true); }
    };

    $('testDmBtn').onclick = async () => {
      try {
        await api('/api/test-dm', {
          method: 'POST',
          body: JSON.stringify({ message: $('testDmInput').value || 'hello from dashboard' }),
        });
        toast('Test DM sent');
      } catch (e) { toast(e.message, true); }
    };

    $('nudgeBtn').onclick = async () => {
      try {
        await api('/nudge', {
          method: 'POST',
          body: JSON.stringify({
            secret,
            name: $('nudgeName').value || 'dashboard',
            message: $('nudgeMsg').value || '(empty)',
            timestamp: Date.now(),
          }),
        });
        toast('Nudge sent');
      } catch (e) { toast(e.message, true); }
    };

    // Auto-login if secret already stored
    if (secret) {
      tryLogin(secret).catch(() => {
        localStorage.removeItem(STORAGE_KEY);
        secret = '';
      });
    }
  </script>
</body>
</html>`;
}

function startHttpServer(ctx) {
  const { client } = ctx;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, x-nudge-secret, Authorization',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        });
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathName = url.pathname.replace(/\/$/, '') || '/';

      // Public dashboard shell (auth happens in-browser via localStorage)
      if (req.method === 'GET' && pathName === '/') {
        text(res, 200, buildDashboardHtml(), 'text/html; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && pathName === '/health') {
        json(res, 200, {
          ok: true,
          ready: !!client.user,
          hostOnline: roblox.currentIsOnline,
          uptimeMs: Date.now() - ctx.startTime,
        });
        return;
      }

      if (req.method === 'GET' && pathName === '/api/host') {
        const day = roblox.getUptimeStats(24 * 60 * 60 * 1000);
        json(res, 200, {
          ok: true,
          online: roblox.currentIsOnline,
          description: roblox.getHostDescription(),
          todayUptimePercent: Number(day.uptimePercent.toFixed(1)),
          todayChecks: day.totalChecks,
          currentStreakMs: day.currentStreakMs || 0,
          checkIntervalMs: CHECK_INTERVAL_MS,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (req.method === 'GET' && pathName === '/api/info') {
        if (!requireSecret(req, url, res)) return;
        json(res, 200, buildInfo(ctx));
        return;
      }

      if (req.method === 'POST' && pathName === '/api/presence/check') {
        if (!requireSecret(req, url, res)) return;
        await roblox.checkPresence(client);
        json(res, 200, {
          ok: true,
          online: roblox.currentIsOnline,
          checkedAt: new Date().toISOString(),
        });
        return;
      }

      if (req.method === 'POST' && pathName === '/api/config') {
        if (!requireSecret(req, url, res)) return;
        const raw = await readBody(req);
        let data = {};
        try {
          data = JSON.parse(raw || '{}');
        } catch {
          json(res, 400, { ok: false, error: 'invalid json' });
          return;
        }

        if (data.provider === 'mistral' || data.provider === 'navy') {
          botConfig.provider = data.provider;
          if (!data.aiModel && PROVIDER_DEFAULTS[data.provider]) {
            botConfig.aiModel = PROVIDER_DEFAULTS[data.provider].model;
          }
        }
        if (typeof data.aiModel === 'string' && data.aiModel.trim()) {
          botConfig.aiModel = data.aiModel.trim().slice(0, 100);
        }
        if (typeof data.maxReplies === 'number' && data.maxReplies >= 1 && data.maxReplies <= 50) {
          botConfig.maxReplies = Math.floor(data.maxReplies);
        }
        if (typeof data.allowOthersToReply === 'boolean') {
          botConfig.allowOthersToReply = data.allowOthersToReply;
        }

        json(res, 200, {
          ok: true,
          ai: {
            provider: botConfig.provider,
            model: botConfig.aiModel,
            maxReplies: botConfig.maxReplies,
            allowOthersToReply: botConfig.allowOthersToReply,
          },
        });
        return;
      }

      if (req.method === 'POST' && pathName === '/api/host/description') {
        if (!requireSecret(req, url, res)) return;
        const raw = await readBody(req);
        let data = {};
        try {
          data = JSON.parse(raw || '{}');
        } catch {
          json(res, 400, { ok: false, error: 'invalid json' });
          return;
        }
        const desc = roblox.setHostDescription(data.description || '');
        await roblox.updateStatusEmbed(client, roblox.currentIsOnline);
        json(res, 200, { ok: true, description: desc });
        return;
      }

      if (req.method === 'POST' && pathName === '/api/test-dm') {
        if (!requireSecret(req, url, res)) return;
        const raw = await readBody(req);
        let data = {};
        try {
          data = JSON.parse(raw || '{}');
        } catch {
          json(res, 400, { ok: false, error: 'invalid json' });
          return;
        }
        const message = String(data.message || 'hello from dashboard').slice(0, 500);
        const user = await client.users.fetch(OWNER_ID);
        await user.send({
          embeds: [
            {
              title: '🍋 Dashboard test DM',
              description: message,
              color: 0xfdff94,
              timestamp: new Date().toISOString(),
            },
          ],
        });
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && pathName === '/nudge') {
        const raw = await readBody(req);
        let data = {};
        try {
          data = JSON.parse(raw || '{}');
        } catch {
          json(res, 400, { ok: false, error: 'invalid json' });
          return;
        }

        if (data.secret !== NUDGE_SECRET) {
          res.writeHead(401);
          res.end('nope');
          return;
        }

        const name = data.name || 'Anonymous';
        const message = data.message || '(empty)';
        const time = new Date(data.timestamp || Date.now()).toLocaleString('en-GB', {
          timeZone: 'Europe/Moscow',
        });

        const user = await client.users.fetch(OWNER_ID);
        await user.send({
          embeds: [
            {
              title: '🍋 New message from the site',
              description: `**From:** ${name}\n**Time (MSK):** ${time}\n\n${message}`,
              color: 0xfdff94,
              timestamp: new Date().toISOString(),
            },
          ],
        });

        json(res, 200, { ok: true });
        return;
      }

      json(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      console.error('HTTP server error:', err);
      json(res, 500, { ok: false, error: err.message || 'error' });
    }
  });

  server.listen(15612, () => {
    console.log('HTTP server listening on :15612 (nudge + interactive dashboard)');
  });

  return server;
}

module.exports = { startHttpServer };
