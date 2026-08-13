const http = require('http');
const os = require('os');
const { URL } = require('url');
const {
  OWNER_ID,
  NUDGE_SECRET,
  CHECK_INTERVAL_MS,
  botConfig,
  CUSTOM_DESCRIPTION,
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

function formatUptime(ms) {
  return formatDuration(ms);
}

function buildInfo(ctx) {
  const { client, startTime, commands } = ctx;
  const mem = process.memoryUsage();
  const dayStats = roblox.getUptimeStats(24 * 60 * 60 * 1000);
  const allStats = roblox.getUptimeStats(3 * 24 * 60 * 60 * 1000);

  return {
    ok: true,
    bot: {
      tag: client.user?.tag || null,
      id: client.user?.id || null,
      ready: client.isReady?.() ?? !!client.user,
      uptimeMs: Date.now() - startTime,
      uptime: formatUptime(Date.now() - startTime),
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
    },
    host: {
      online: roblox.currentIsOnline,
      description: CUSTOM_DESCRIPTION,
      checkIntervalMs: CHECK_INTERVAL_MS,
      today: {
        uptimePercent: Number(dayStats.uptimePercent.toFixed(1)),
        onlineChecks: dayStats.onlineChecks,
        totalChecks: dayStats.totalChecks,
        currentStreakMs: dayStats.currentStreakMs,
        currentStreak: formatUptime(dayStats.currentStreakMs || 0),
      },
      last3d: {
        uptimePercent: Number(allStats.uptimePercent.toFixed(1)),
        onlineChecks: allStats.onlineChecks,
        totalChecks: allStats.totalChecks,
      },
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

function buildDashboardHtml(info) {
  const hostColor = info.host.online ? '#3ba55d' : '#ed4245';
  const hostLabel = info.host.online ? 'ONLINE' : 'OFFLINE';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>lemonAI · bot status</title>
  <style>
    :root { color-scheme: dark; }
    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: #0f0f10;
      color: #e8e6e3;
      margin: 0;
      padding: 2rem;
      line-height: 1.5;
    }
    h1 { color: #fdff94; margin: 0 0 0.25rem; }
    .sub { color: #888; margin-bottom: 2rem; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 1rem;
    }
    .card {
      background: #1a1a1d;
      border: 1px solid #2a2a2e;
      border-radius: 12px;
      padding: 1rem 1.25rem;
    }
    .card h2 {
      margin: 0 0 0.75rem;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #aaa;
    }
    .big { font-size: 1.6rem; font-weight: 700; }
    .host { color: ${hostColor}; }
    .muted { color: #777; font-size: 0.85rem; }
    ul { margin: 0; padding-left: 1.1rem; }
    a { color: #fdff94; }
    code { background: #111; padding: 0.1em 0.35em; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>🍋 lemonAI</h1>
  <p class="sub">${info.bot.tag || 'bot'} · refreshed live from the same port as /nudge</p>

  <div class="grid">
    <div class="card">
      <h2>Host</h2>
      <div class="big host">${hostLabel}</div>
      <p class="muted">${info.host.description}</p>
      <p>Today: <strong>${info.host.today.uptimePercent}%</strong> (${info.host.today.onlineChecks}/${info.host.today.totalChecks})</p>
      <p>Streak: <strong>${info.host.today.currentStreak}</strong></p>
    </div>

    <div class="card">
      <h2>Bot</h2>
      <p>Uptime: <strong>${info.bot.uptime}</strong></p>
      <p>Ping: <strong>${info.bot.ping ?? '—'}ms</strong></p>
      <p>Guilds: <strong>${info.bot.guilds}</strong></p>
      <p>Commands: <strong>${info.bot.commandCount}</strong></p>
      <p>Reminders: <strong>${info.reminders.pending}</strong></p>
    </div>

    <div class="card">
      <h2>AI</h2>
      <p>Provider: <code>${info.ai.provider}</code></p>
      <p>Model: <code>${info.ai.model}</code></p>
    </div>

    <div class="card">
      <h2>System</h2>
      <p>${info.system.platform}/${info.system.arch} · ${info.system.node}</p>
      <p>RSS: <strong>${info.system.memory.rssMB} MB</strong></p>
      <p>Heap: <strong>${info.system.memory.heapUsedMB}/${info.system.memory.heapTotalMB} MB</strong></p>
      <p>Load: <strong>${info.system.loadavg.join(' ')}</strong></p>
    </div>
  </div>

  <div class="card" style="margin-top:1rem">
    <h2>API</h2>
    <ul>
      <li><code>GET /health</code> — public healthcheck</li>
      <li><code>GET /api/host</code> — public host status JSON</li>
      <li><code>GET /api/info?secret=…</code> — full bot info JSON</li>
      <li><code>POST /api/presence/check</code> — force presence check (secret)</li>
      <li><code>POST /nudge</code> — site → Discord DM (secret)</li>
    </ul>
  </div>

  <p class="muted" style="margin-top:1.5rem">${info.timestamp}</p>
  <script>setTimeout(() => location.reload(), 60000);</script>
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

      // ---- public ----
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
          description: CUSTOM_DESCRIPTION,
          todayUptimePercent: Number(day.uptimePercent.toFixed(1)),
          todayChecks: day.totalChecks,
          currentStreakMs: day.currentStreakMs || 0,
          checkIntervalMs: CHECK_INTERVAL_MS,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // ---- dashboard (protected) ----
      if (req.method === 'GET' && pathName === '/') {
        if (!requireSecret(req, url, res)) return;
        const info = buildInfo(ctx);
        text(res, 200, buildDashboardHtml(info), 'text/html; charset=utf-8');
        return;
      }

      // ---- full info (protected) ----
      if (req.method === 'GET' && pathName === '/api/info') {
        if (!requireSecret(req, url, res)) return;
        json(res, 200, buildInfo(ctx));
        return;
      }

      // ---- force presence check (protected) ----
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

      // ---- nudge (existing) ----
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
    console.log('HTTP server listening on :15612 (nudge + status API)');
  });

  return server;
}

module.exports = { startHttpServer };
