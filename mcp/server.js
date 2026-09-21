import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Client, GatewayIntentBits } from "discord.js";
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

// ---------- Discord client ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// ---------- Simple reminder store (separate from main bot) ----------
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

// ---------- Wall mod helper ----------
async function callWallMod({ action, id, text }) {
  if (!ONLINE_SECRET) throw new Error("ONLINE_SECRET not set in .env");
  const body = { password: ONLINE_SECRET, action, id };
  if (text != null) body.text = text;
  const r = await fetch(`${SITE_URL.replace(/\/$/, "")}/api/wall-mod`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `wall-mod ${r.status}`);
  return data;
}

// ---------- Roblox presence ----------
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

// ---------- MCP Server ----------
const server = new McpServer({
  name: "lemons-landfill-mcp",
  version: "1.0.0",
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
      if (!ms) return { content: [{ type: "text", text: "❌ Invalid duration. Use e.g. 10m, 2h, 1d" }] };
      const r = addReminder({ userId: OWNER_ID, channelId: null, message, durationMs: ms });
      return {
        content: [{
          type: "text",
          text: `✅ Reminder set!\nID: ${r.id}\nIn: ${formatDuration(ms)}\nMessage: ${r.message}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ ${e.message}` }] };
    }
  }
);

server.tool(
  "list_reminders",
  "List all pending reminders",
  {},
  async () => {
    const list = [...reminders.values()].sort((a, b) => a.dueAt - b.dueAt);
    if (!list.length) return { content: [{ type: "text", text: "No pending reminders 🍋" }] };
    const text = list
      .map((r) => `• ${r.id} — in ${formatDuration(r.dueAt - Date.now())}: ${r.message}`)
      .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "cancel_reminder",
  "Cancel a reminder by its ID",
  { id: z.string().describe("Reminder ID from list_reminders") },
  async ({ id }) => {
    const r = reminders.get(id);
    if (!r) return { content: [{ type: "text", text: "❌ Reminder not found" }] };
    if (r.timeout) clearTimeout(r.timeout);
    reminders.delete(id);
    saveReminders();
    return { content: [{ type: "text", text: `✅ Cancelled reminder ${id}` }] };
  }
);

// ===== WALL MODERATION =====
server.tool(
  "wall_approve",
  "Approve a pending wall post by its wall ID",
  { wallId: z.string().describe("The wall post ID") },
  async ({ wallId }) => {
    try {
      await callWallMod({ action: "approve", id: wallId });
      return { content: [{ type: "text", text: `🟢 Wall ${wallId} approved` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ ${e.message}` }] };
    }
  }
);

server.tool(
  "wall_reject",
  "Reject a pending wall post by its wall ID",
  { wallId: z.string().describe("The wall post ID") },
  async ({ wallId }) => {
    try {
      await callWallMod({ action: "reject", id: wallId });
      return { content: [{ type: "text", text: `🚫 Wall ${wallId} rejected` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ ${e.message}` }] };
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
      return { content: [{ type: "text", text: `🍋 Reply posted on wall ${wallId}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ ${e.message}` }] };
    }
  }
);

// ===== ROBLOX PRESENCE =====
server.tool(
  "roblox_status",
  "Check if the host is currently online in the Roblox game",
  {},
  async () => {
    try {
      const p = await checkRobloxPresence();
      return {
        content: [{
          type: "text",
          text: p.online
            ? `🟢 ONLINE in the game\nplaceId: ${p.placeId}\nlastLocation: ${p.lastLocation || "n/a"}`
            : `🔴 OFFLINE\nlastLocation: ${p.lastLocation || "n/a"}`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ ${e.message}` }] };
    }
  }
);

// ===== BASIC UTILS =====
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
      if (!ch?.isTextBased()) return { content: [{ type: "text", text: "❌ Not a text channel" }] };
      const msg = await ch.send(content.slice(0, 2000));
      return { content: [{ type: "text", text: `✅ Sent (id: ${msg.id})` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `❌ ${e.message}` }] };
    }
  }
);

server.tool(
  "bot_status",
  "Get basic status of this MCP + Discord connection",
  {},
  async () => {
    const up = Math.floor(process.uptime());
    return {
      content: [{
        type: "text",
        text: `🍋 MCP online\nDiscord: ${client.user?.tag || "connecting..."}\nUptime: ${formatDuration(up * 1000)}\nPending reminders: ${reminders.size}`,
      }],
    };
  }
);

// ---------- boot ----------
async function main() {
  loadReminders();
  for (const r of reminders.values()) scheduleReminder(r);

  await client.login(DISCORD_TOKEN);
  console.error(`Discord ready as ${client.user.tag}`); // stderr so stdio stays clean

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
