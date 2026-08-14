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
const customCommands = require('./customCommands');
const botPresence = require('./botPresence');
const { buildDashboardHtml } = require('./dashboardHtml');
const { buildCustomCommandHtml } = require('./customCommandHtml');

function json(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-nudge-secret, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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
    presence: botPresence.getPresence(),
    customCommands: customCommands.getAllCommands().map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      enabled: c.enabled,
      responseType: c.responseType,
      guildId: c.guildId,
    })),
    timestamp: new Date().toISOString(),
  };
}

function startHttpServer(ctx) {
  const { client } = ctx;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, x-nudge-secret, Authorization',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        });
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathName = url.pathname.replace(/\/$/, '') || '/';

      if (req.method === 'GET' && pathName === '/') {
        text(res, 200, buildDashboardHtml(), 'text/html; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && pathName === '/cc') {
        text(res, 200, buildCustomCommandHtml(), 'text/html; charset=utf-8');
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
        let data = {};
        try {
          data = JSON.parse((await readBody(req)) || '{}');
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
        let data = {};
        try {
          data = JSON.parse((await readBody(req)) || '{}');
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
        let data = {};
        try {
          data = JSON.parse((await readBody(req)) || '{}');
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
        let data = {};
        try {
          data = JSON.parse((await readBody(req)) || '{}');
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

      if (req.method === 'GET' && pathName === '/api/custom-commands') {
        if (!requireSecret(req, url, res)) return;
        json(res, 200, { ok: true, commands: customCommands.getAllCommands() });
        return;
      }

      if (req.method === 'POST' && pathName === '/api/custom-commands') {
        if (!requireSecret(req, url, res)) return;
        let data = {};
        try {
          data = JSON.parse((await readBody(req)) || '{}');
        } catch {
          json(res, 400, { ok: false, error: 'invalid json' });
          return;
        }
        try {
          const cmd = customCommands.addCommand({ ...data, createdBy: OWNER_ID });
          json(res, 200, { ok: true, command: cmd });
        } catch (e) {
          json(res, 400, { ok: false, error: e.message });
        }
        return;
      }

      if (req.method === 'PATCH' && pathName.startsWith('/api/custom-commands/') && !pathName.endsWith('/reregister')) {
        if (!requireSecret(req, url, res)) return;
        const id = pathName.split('/').pop();
        let data = {};
        try {
          data = JSON.parse((await readBody(req)) || '{}');
        } catch {
          json(res, 400, { ok: false, error: 'invalid json' });
          return;
        }
        try {
          const cmd = customCommands.updateCommand(id, data);
          json(res, 200, { ok: true, command: cmd });
        } catch (e) {
          json(res, 400, { ok: false, error: e.message });
        }
        return;
      }

      if (req.method === 'DELETE' && pathName.startsWith('/api/custom-commands/')) {
        if (!requireSecret(req, url, res)) return;
        const id = pathName.split('/').pop();
        try {
          const cmd = customCommands.deleteCommand(id);
          json(res, 200, { ok: true, command: cmd });
        } catch (e) {
          json(res, 400, { ok: false, error: e.message });
        }
        return;
      }

      if (req.method === 'POST' && pathName === '/api/custom-commands/reregister') {
        if (!requireSecret(req, url, res)) return;
        try {
          const { REST, Routes } = require('discord.js');
          const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
          const builtIn = ctx.commands ? [...ctx.commands.values()].map(c => c.data.toJSON()) : [];
          const custom = customCommands.getCustomSlashJSON();
          const names = new Set(builtIn.map(c => c.name));
          const body = [...builtIn, ...custom.filter(c => !names.has(c.name))];
          await rest.put(Routes.applicationCommands(client.user.id), { body });
          json(res, 200, { ok: true, count: body.length });
        } catch (e) {
          json(res, 500, { ok: false, error: e.message });
        }
        return;
      }

      if (req.method === 'POST' && pathName === '/api/presence') {
        if (!requireSecret(req, url, res)) return;
        let data = {};
        try {
          data = JSON.parse((await readBody(req)) || '{}');
        } catch {
          json(res, 400, { ok: false, error: 'invalid json' });
          return;
        }
        try {
          botPresence.setPresenceConfig(data);
          await botPresence.applyPresence(client);
          json(res, 200, { ok: true, presence: botPresence.getPresence() });
        } catch (e) {
          json(res, 400, { ok: false, error: e.message });
        }
        return;
      }

      if (req.method === 'GET' && pathName === '/api/presence') {
        if (!requireSecret(req, url, res)) return;
        json(res, 200, { ok: true, presence: botPresence.getPresence() });
        return;
      }

      json(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      console.error('HTTP server error:', err);
      json(res, 500, { ok: false, error: err.message || 'error' });
    }
  });

  server.listen(15612, () => {
    console.log('HTTP server listening on :15612 (nudge + interactive dashboard + /cc)');
  });

  return server;
}

module.exports = { startHttpServer };
