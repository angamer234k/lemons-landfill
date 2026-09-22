const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const {
  ROBLOX_USER_ID,
  ROBLOX_GAME_ID,
  DISCORD_CHANNEL_ID,
  CUSTOM_DESCRIPTION,
} = require('./config');

const HISTORY_FILE = path.join(__dirname, '..', 'uptime_history.json');
const STATUS_MSG_FILE = path.join(__dirname, '..', 'status_message.json');
const MAX_HISTORY_ENTRIES = 864; // ~3 days at 5-min intervals

/** Public graph image on the site (cache-bust with &t=) */
const GRAPH_PNG_BASE =
  process.env.ROBLOX_GRAPH_URL ||
  'https://www.xn--e1aleee.space/api/png/roblox?period=3d';

let statusMessage = null;
let statusMessageId = null;
let currentIsOnline = false;
let history = [];
let hostDescription = CUSTOM_DESCRIPTION;
let lastCleanupAt = 0;

function getHostDescription() {
  return hostDescription;
}

function setHostDescription(text) {
  hostDescription = String(text || '').slice(0, 500);
  return hostDescription;
}

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (Array.isArray(data)) {
        history = data;
        console.log(`Loaded ${history.length} uptime history entries.`);
      }
    }
  } catch (err) {
    console.error('Failed to load uptime history:', err.message);
    history = [];
  }
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 0));
  } catch (err) {
    console.error('Failed to save uptime history:', err.message);
  }
}

function loadStatusMessageId() {
  try {
    if (fs.existsSync(STATUS_MSG_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATUS_MSG_FILE, 'utf8'));
      if (data && data.id) {
        statusMessageId = String(data.id);
        console.log(`Loaded status message id: ${statusMessageId}`);
      }
    }
  } catch (err) {
    console.error('Failed to load status message id:', err.message);
  }
}

function saveStatusMessageId(id) {
  statusMessageId = id ? String(id) : null;
  try {
    if (!id) {
      if (fs.existsSync(STATUS_MSG_FILE)) fs.unlinkSync(STATUS_MSG_FILE);
      return;
    }
    fs.writeFileSync(
      STATUS_MSG_FILE,
      JSON.stringify({ id: String(id), updatedAt: Date.now() })
    );
  } catch (err) {
    console.error('Failed to save status message id:', err.message);
  }
}

function recordPresence(isOnline) {
  const entry = { ts: Date.now(), online: !!isOnline };
  history.push(entry);
  if (history.length > MAX_HISTORY_ENTRIES) {
    history = history.slice(-MAX_HISTORY_ENTRIES);
  }
  saveHistory();
}

function getHistory(sinceMs = 0) {
  if (!sinceMs) return [...history];
  const cutoff = Date.now() - sinceMs;
  return history.filter(e => e.ts >= cutoff);
}

function getUptimeStats(sinceMs = 24 * 60 * 60 * 1000) {
  const entries = getHistory(sinceMs);
  if (entries.length === 0) {
    return {
      totalChecks: 0,
      onlineChecks: 0,
      uptimePercent: 0,
      sessions: [],
      currentStreakMs: 0,
      longestOnlineMs: 0,
      longestOfflineMs: 0,
    };
  }

  const onlineChecks = entries.filter(e => e.online).length;
  const uptimePercent = (onlineChecks / entries.length) * 100;

  const sessions = [];
  let current = { online: entries[0].online, start: entries[0].ts, end: entries[0].ts };

  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    if (e.online === current.online) {
      current.end = e.ts;
    } else {
      sessions.push({ ...current });
      current = { online: e.online, start: e.ts, end: e.ts };
    }
  }
  sessions.push(current);

  const now = Date.now();
  const last = sessions[sessions.length - 1];
  if (now - last.end < 12 * 60 * 1000) {
    last.end = now;
  }

  let longestOnlineMs = 0;
  let longestOfflineMs = 0;
  for (const s of sessions) {
    const dur = s.end - s.start;
    if (s.online) longestOnlineMs = Math.max(longestOnlineMs, dur);
    else longestOfflineMs = Math.max(longestOfflineMs, dur);
  }

  const currentStreakMs = last.end - last.start;

  return {
    totalChecks: entries.length,
    onlineChecks,
    uptimePercent,
    sessions,
    currentStreakMs,
    longestOnlineMs,
    longestOfflineMs,
    currentOnline: last.online,
  };
}

function graphImageUrl() {
  const sep = GRAPH_PNG_BASE.includes('?') ? '&' : '?';
  return `${GRAPH_PNG_BASE}${sep}t=${Date.now()}`;
}

function buildEmbed(isOnline) {
  const color = isOnline ? 0x00ff00 : 0xff0000;
  const title = isOnline ? 'ONLINE' : 'OFFLINE';
  const day = getUptimeStats(24 * 60 * 60 * 1000);
  const pct = day.totalChecks > 0 ? day.uptimePercent.toFixed(1) : '—';

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      `${hostDescription}\n\n` +
        `**Today:** \`${pct}%\` uptime` +
        (day.totalChecks
          ? ` (${day.onlineChecks}/${day.totalChecks} checks)`
          : '')
    )
    .setColor(color)
    .setImage(graphImageUrl())
    .setTimestamp()
    .setFooter({ text: 'Last updated · graph = last 3d' });
}

async function resolveChannel(client) {
  let channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
  if (!channel) {
    try {
      channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    } catch (error) {
      console.error('Could not locate the status channel:', error.message);
      return null;
    }
  }
  return channel;
}

/** Delete older bot status embeds in the channel, keep only `keepId`. */
async function cleanupOldStatusMessages(channel, client, keepId) {
  const now = Date.now();
  // at most once per 30 min so we don't spam the API
  if (now - lastCleanupAt < 30 * 60 * 1000) return;
  lastCleanupAt = now;

  try {
    const me = client.user?.id;
    if (!me) return;

    const fetched = await channel.messages.fetch({ limit: 30 });
    const toDelete = [];
    for (const msg of fetched.values()) {
      if (msg.author?.id !== me) continue;
      if (keepId && msg.id === keepId) continue;
      // only touch embeds that look like our status posts
      const title = msg.embeds?.[0]?.title;
      if (title === 'ONLINE' || title === 'OFFLINE') {
        toDelete.push(msg);
      }
    }

    for (const msg of toDelete) {
      try {
        await msg.delete();
      } catch (e) {
        // missing perms / already gone
      }
    }
    if (toDelete.length) {
      console.log(`Cleaned ${toDelete.length} old status embed(s).`);
    }
  } catch (err) {
    console.warn('Status cleanup failed:', err.message);
  }
}

async function updateStatusEmbed(client, isOnline) {
  currentIsOnline = isOnline;
  const channel = await resolveChannel(client);
  if (!channel) return;

  const embed = buildEmbed(isOnline);
  const payload = { embeds: [embed] };

  // 1) try in-memory message
  if (statusMessage) {
    try {
      await statusMessage.edit(payload);
      await cleanupOldStatusMessages(channel, client, statusMessage.id);
      return;
    } catch (error) {
      if (error.code === 10008) {
        statusMessage = null;
        saveStatusMessageId(null);
      } else {
        console.warn('Status edit failed:', error.message);
      }
    }
  }

  // 2) try persisted message id after restart
  if (!statusMessage && statusMessageId) {
    try {
      const msg = await channel.messages.fetch(statusMessageId);
      statusMessage = msg;
      await msg.edit(payload);
      await cleanupOldStatusMessages(channel, client, msg.id);
      return;
    } catch (error) {
      // gone or unreadable
      statusMessage = null;
      saveStatusMessageId(null);
    }
  }

  // 3) send a fresh one, then wipe older duplicates
  try {
    statusMessage = await channel.send(payload);
    saveStatusMessageId(statusMessage.id);
    await cleanupOldStatusMessages(channel, client, statusMessage.id);
  } catch (error) {
    console.error('Could not send status embed:', error.message);
  }
}

async function checkPresence(client) {
  try {
    const response = await fetch('https://presence.roblox.com/v1/presence/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: [ROBLOX_USER_ID] }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const presence = data.userPresences?.find(p => p.userId === ROBLOX_USER_ID);
    if (!presence) return;
    const isOnline = presence.placeId === ROBLOX_GAME_ID;
    recordPresence(isOnline);
    await updateStatusEmbed(client, isOnline);
  } catch (error) {
    console.error('Error checking presence:', error.message);
  }
}

loadHistory();
loadStatusMessageId();

module.exports = {
  updateStatusEmbed,
  checkPresence,
  getHistory,
  getUptimeStats,
  loadHistory,
  getHostDescription,
  setHostDescription,
  get currentIsOnline() {
    return currentIsOnline;
  },
};
