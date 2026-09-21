import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Client, GatewayIntentBits, ChannelType } from "discord.js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REMINDERS_FILE = path.join(__dirname, "mcp_reminders.json");

const {
  DISCORD_TOKEN,
  OWNER_ID = "1131451961942749206",
  ONLINE_SECRET,
  SITE_URL = "https://xn--e1aleee.space",
} = process.env;

if (!DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN in .env");
  process.exit(1);
}

const siteBase = SITE_URL.replace(/\/$/, "");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

/** @type {Map<string, any>} */
const reminders = new Map();

function loadReminders() {
  try {
    if (fs.existsSync(REMINDERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(REMINDERS_FILE, "utf8"));
      if (Array.isArray(data)) {
        const now = Date.now();
        for (const r of data) {
          if (r.dueAt > now) reminders.set(r.id, { ...r, timeout: null });
        }
      }
    }
  } catch {}
}

function saveReminders() {
  const list = [...reminders.values()].map(({ id, userId, channelId, message, dueAt }) => ({
    id, userId, channelId, message, dueAt,
  }));
  fs.writeFileSync(REMINDERS_FILE, JSON.stringify(list, null, 2));
}

function parseDuration(input) {
  if (!input) return null;
  const str = String(input).trim().toLowerCase();
  const re = /(\d+)\s*(d|h|m|s)/g;
  let total = 0, matched = false, m;
  while ((m = re.exec(str)) !== null) {
    matched = true;
    const n = parseInt(m[1], 10);
    if (m[2] === "d") total += n * 86400000;
    else if (m[2] === "h") total += n * 3600000;
    else if (m[2] === "m") total += n * 60000;
    else if (m[2] === "s") total += n * 1000;
  }
  return matched && total > 0 ? total : null;
}

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (sec && parts.length === 0) parts.push(`${sec}s`);
  return parts.join(" ") || "0s";
}

async function fireReminder(r) {
  reminders.delete(r.id);
  saveReminders();
  try {
    const user = await client.users.fetch(r.userId);
    await user.send(`⏰ **Reminding:** ${r.message}`).catch(async () => {
      if (r.channelId) {
        const ch = await client.channels.fetch(r.channelId).catch(() => null);
        if (ch?.isTextBased()) await ch.send(`<@${r.userId}> ⏰ **Reminding:** ${r.message}`);
      }
    });
  } catch {}
}

function scheduleReminder(r) {
  const delay = r.dueAt - Date.now();
  if (delay <= 0) return fireReminder(r);
  r.timeout = setTimeout(() => fireReminder(r), delay);
}

function addReminder({ userId, channelId, message, durationMs }) {
  if (durationMs < 30000) throw new Error("Minimum 30 seconds");
  if (durationMs > 7 * 86400000) throw new Error("Maximum 7 days");
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const reminder = {
    id,
    userId,
    channelId: channelId || null,
    message: String(message).slice(0, 500),
    dueAt: Date.now() + durationMs,
    timeout: null,
  };
  reminders.set(id, reminder);
  saveReminders();
  scheduleReminder(reminder);
  return reminder;
}

async function callWallMod({ action, id, text } = {}) {
  if (!ONLINE_SECRET) throw new Error("ONLINE_SECRET not set in .env");
  const body = { password: ONLINE_SECRET, action };
  if (id != null) body.id = id;
  if (text != null) body.text = text;
  const r = await fetch(`${siteBase}/api/wall-mod`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `wall-mod ${r.status}`);
  return data;
}

async function fetchLiveWall() {
  const r = await fetch(`${siteBase}/api/wall`, { signal: AbortSignal.timeout(10000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `wall ${r.status}`);
  return data;
}

const ROBLOX_USER_ID = 10855335836;
const ROBLOX_GAME_ID = 16855862021;

async function checkRobloxPresence() {
  const res = await fetch("https://presence.roblox.com/v1/presence/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userIds: [ROBLOX_USER_ID] }),
  });
  if (!res.ok) throw new Error(`Roblox API ${res.status}`);
  const data = await res.json();
  const presence = data.userPresences?.find((p) => p.userId === ROBLOX_USER_ID);
  if (!presence) return { online: false, raw: null };
  const isOnline = presence.placeId === ROBLOX_GAME_ID;
  return {
    online: isOnline,
    placeId: presence.placeId,
    rootPlaceId: presence.rootPlaceId,
    gameId: presence.gameId,
    userPresenceType: presence.userPresenceType,
    lastLocation: presence.lastLocation,
  };
}

function ok(text) {
  return { content: [{ type: "text", text }] };
}
function fail(e) {
  return { content: [{ type: "text", text: `❌ ${e?.message || e}` }] };
}

const server = new McpServer({
  name: "lemons-landfill-mcp",
  version: "1.1.0",
});

// ===== REMINDERS =====
server.tool(
  "add_reminder",
  "Set a reminder for the owner. Duration like '10m', '2h', '1d 3h'. Will DM the owner when due.",
  {
    duration: z.string().describe("How long until the reminder, e.g. 10m, 2h, 1d"),
    message: z.string().describe("What to remind about"),
  },
  async ({ duration, message }) => {
    try {
      const ms = parseDuration(duration);
      if (!ms) return ok("❌ Invalid duration. Use e.g. 10m, 2h, 1d");
      const r = addReminder({ userId: OWNER_ID, channelId: null, message, durationMs: ms });
      return ok(`✅ Reminder set!\nID: ${r.id}\nIn: ${formatDuration(ms)}\nMessage: ${r.message}`);
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool("list_reminders", "List all pending reminders", {}, async () => {
  const list = [...reminders.values()].sort((a, b) => a.dueAt - b.dueAt);
  if (!list.length) return ok("No pending reminders 🍋");
  return ok(list.map((r) => `• ${r.id} — in ${formatDuration(r.dueAt - Date.now())}: ${r.message}`).join("\n"));
});

server.tool(
  "cancel_reminder",
  "Cancel a reminder by its ID",
  { id: z.string().describe("Reminder ID from list_reminders") },
  async ({ id }) => {
    const r = reminders.get(id);
    if (!r) return ok("❌ Reminder not found");
    if (r.timeout) clearTimeout(r.timeout);
    reminders.delete(id);
    saveReminders();
    return ok(`✅ Cancelled reminder ${id}`);
  }
);

// ===== WALL =====
server.tool(
  "wall_list",
  "List wall posts. status=live (public), pending (needs mod password), or all. Use this before approve/reject.",
  {
    status: z.enum(["live", "pending", "all"]).optional().describe("Filter: live, pending, or all. Default all"),
  },
  async ({ status }) => {
    try {
      const mode = status || "all";
      const lines = [];

      if (mode === "live" || mode === "all") {
        const live = await fetchLiveWall();
        const msgs = live.messages || [];
        lines.push(`🟢 LIVE (${msgs.length})`);
        if (!msgs.length) lines.push("  (none)");
        for (const m of msgs.slice(0, 30)) {
          const when = m.timestamp ? new Date(m.timestamp).toISOString() : "?";
          const reply = m.reply?.text ? ` | reply: ${String(m.reply.text).slice(0, 80)}` : "";
          const img = m.hasImage ? " [img]" : "";
          lines.push(`  • ${m.id} — ${m.name || "anon"}: ${String(m.message || "").slice(0, 120)}${img}${reply} (${when})`);
        }
      }

      if (mode === "pending" || mode === "all") {
        if (!ONLINE_SECRET) {
          lines.push("⏳ PENDING: ONLINE_SECRET not set — cannot list pending");
        } else {
          let pendingData = null;
          let lastErr = null;
          for (const action of ["list", "pending", "get"]) {
            try {
              pendingData = await callWallMod({ action });
              break;
            } catch (e) {
              lastErr = e;
            }
          }
          if (!pendingData) {
            lines.push(`⏳ PENDING: could not fetch (${lastErr?.message || "unknown"})`);
          } else {
            const arr =
              pendingData.pending ||
              pendingData.messages ||
              pendingData.items ||
              (Array.isArray(pendingData) ? pendingData : null);
            if (Array.isArray(arr)) {
              const onlyPending = arr.filter((m) => !m.status || m.status === "pending" || m.wallStatus === "pending");
              const show = mode === "pending" ? (onlyPending.length ? onlyPending : arr) : onlyPending;
              lines.push(`⏳ PENDING (${show.length})`);
              if (!show.length) lines.push("  (none)");
              for (const m of show.slice(0, 30)) {
                const id = m.id || m.wallId || "?";
                const name = m.name || m.from || "anon";
                const msg = String(m.message || m.text || "").slice(0, 120);
                lines.push(`  • ${id} — ${name}: ${msg}`);
              }
            } else {
              lines.push("⏳ PENDING raw response:");
              lines.push(JSON.stringify(pendingData, null, 2).slice(0, 1500));
            }
          }
        }
      }

      return ok(lines.join("\n"));
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  "wall_approve",
  "Approve a pending wall post by its wall ID (from wall_list)",
  { wallId: z.string().describe("The wall post ID") },
  async ({ wallId }) => {
    try {
      await callWallMod({ action: "approve", id: wallId });
      return ok(`🟢 Wall ${wallId} approved`);
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  "wall_reject",
  "Reject a pending wall post by its wall ID (from wall_list)",
  { wallId: z.string().describe("The wall post ID") },
  async ({ wallId }) => {
    try {
      await callWallMod({ action: "reject", id: wallId });
      return ok(`🚫 Wall ${wallId} rejected`);
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  "wall_reply",
  "Post a reply under a wall post",
  {
    wallId: z.string().describe("The wall post ID"),
    text: z.string().describe("Reply text (max 1000 chars)"),
  },
  async ({ wallId, text }) => {
    try {
      await callWallMod({ action: "reply", id: wallId, text: text.slice(0, 1000) });
      return ok(`🍋 Reply posted on wall ${wallId}`);
    } catch (e) {
      return fail(e);
    }
  }
);

// ===== ROBLOX =====
server.tool("roblox_status", "Check if the host is currently online in the Roblox game", {}, async () => {
  try {
    const p = await checkRobloxPresence();
    return ok(
      p.online
        ? `🟢 ONLINE in the game\nplaceId: ${p.placeId}\nlastLocation: ${p.lastLocation || "n/a"}`
        : `🔴 OFFLINE\nlastLocation: ${p.lastLocation || "n/a"}`
    );
  } catch (e) {
    return fail(e);
  }
});

// ===== DISCORD =====
server.tool(
  "send_discord_message",
  "Send a message to a Discord channel by ID",
  {
    channelId: z.string().describe("Channel ID"),
    content: z.string().describe("Message content"),
  },
  async ({ channelId, content }) => {
    try {
      const ch = await client.channels.fetch(channelId);
      if (!ch?.isTextBased()) return ok("❌ Not a text channel");
      const msg = await ch.send(content.slice(0, 2000));
      return ok(`✅ Sent (id: ${msg.id})`);
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  "read_discord_messages",
  "Read the last N messages from a Discord channel",
  {
    channelId: z.string().describe("Channel ID"),
    limit: z.number().min(1).max(50).optional().describe("How many messages (1-50, default 10)"),
  },
  async ({ channelId, limit }) => {
    try {
      const ch = await client.channels.fetch(channelId);
      if (!ch?.isTextBased()) return ok("❌ Not a text channel");
      const n = limit || 10;
      const messages = await ch.messages.fetch({ limit: n });
      const text = [...messages.values()]
        .reverse()
        .map((m) => `[${m.author?.tag || m.author?.id}]: ${m.content || "(embed/attachment)"}`)
        .join("\n");
      return ok(text || "(no messages)");
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool(
  "dm_owner",
  "Send a direct message to the bot owner",
  { content: z.string().describe("Message to DM the owner") },
  async ({ content }) => {
    try {
      const user = await client.users.fetch(OWNER_ID);
      await user.send(content.slice(0, 2000));
      return ok("✅ DM sent to owner");
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool("list_guilds", "List Discord servers the bot is in", {}, async () => {
  try {
    const guilds = client.guilds.cache.map((g) => `• ${g.name} (${g.id}) members≈${g.memberCount ?? "?"}`);
    return ok(guilds.length ? guilds.join("\n") : "No guilds");
  } catch (e) {
    return fail(e);
  }
});

server.tool(
  "list_channels",
  "List text channels in a guild",
  { guildId: z.string().describe("Guild/server ID") },
  async ({ guildId }) => {
    try {
      const guild = await client.guilds.fetch(guildId);
      await guild.channels.fetch();
      const channels = guild.channels.cache
        .filter((c) => c.isTextBased?.() || c.type === ChannelType.GuildText)
        .map((c) => `• #${c.name} (${c.id})`);
      return ok(channels.length ? channels.join("\n") : "No text channels");
    } catch (e) {
      return fail(e);
    }
  }
);

server.tool("bot_status", "Get basic status of this MCP + Discord connection", {}, async () => {
  const up = Math.floor(process.uptime());
  return ok(
    `🍋 MCP online\nDiscord: ${client.user?.tag || "connecting..."}\nUptime: ${formatDuration(up * 1000)}\nGuilds: ${client.guilds.cache.size}\nPending reminders: ${reminders.size}`
  );
});

async function main() {
  loadReminders();
  for (const r of reminders.values()) scheduleReminder(r);

  await client.login(DISCORD_TOKEN);
  console.error(`Discord ready as ${client.user.tag}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
