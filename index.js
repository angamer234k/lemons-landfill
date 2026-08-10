require('dotenv').config();
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

// ---------- CONFIG ----------
const ROBLOX_USER_ID = 10855335836;
const ROBLOX_GAME_ID = 16855862021;
const DISCORD_CHANNEL_ID = '1532647917368639559';
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const CUSTOM_DESCRIPTION = 'oh this is the live status for host-it';
const SYSTEM_PROMPT_FILE = './systemPrompt.txt';
const OWNER_ID = '1131451961942749206';
const NUDGE_SECRET = process.env.NUDGE_SECRET || 'change-me';
const MEMORY_FILE = './user_memories.json';
const MAX_MEMORY_MESSAGES = 10;       // persistent memory kept on disk (was 20)
const MAX_HISTORY_TO_MODEL = 8;       // max messages sent to the API per request (saves tokens)
const EMBED_SPLIT_THRESHOLD = 1900;
const MAX_TOOL_CALLS = 5;
const STREAM_EDIT_INTERVAL_MS = 1100; // slower = fewer rate-limit / Missing access errors
const STREAM_MIN_CHARS = 35;         // only push an edit after this many new characters
const STREAM_MIN_LENGTH = 80;        // only bother streaming if reply is longer than this

const botConfig = {
  maxReplies: 5,
  allowOthersToReply: false,
  aiModel: 'mistral-medium-latest', // low token usage default (Navy)
  provider: 'mistral', // 'navy' | 'mistral'
};

const PROVIDER_DEFAULTS = {
  navy: { model: 'gpt-3.5-turbo', base: 'https://api.navy/v1' },
  mistral: { model: 'mistral-small-latest', base: 'https://api.mistral.ai/v1' },
};

// ---------- STATE ----------
let statusMessage = null;
let currentIsOnline = false;
const conversationThreads = new Map(); // messageId -> { user, prompt, replies, history, embedColor, title, model }
const userMemories = new Map();
const startTime = Date.now();
let cachedTextModels = null;
let cachedTextModelsAt = 0;

// ---------- MEMORY PERSISTENCE ----------
function loadMemories() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
      for (const [userId, history] of Object.entries(data)) {
        userMemories.set(userId, history);
      }
      console.log(`Loaded memories for ${userMemories.size} users.`);
    }
  } catch (err) {
    console.error('Failed to load user memories:', err.message);
  }
}

function saveMemories() {
  try {
    const obj = Object.fromEntries(userMemories);
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.error('Failed to save user memories:', err.message);
  }
}

function getUserMemory(userId) {
  return userMemories.get(userId) || [];
}

function updateUserMemory(userId, newMessages) {
  let history = getUserMemory(userId);
  history = [...history, ...newMessages];
  if (history.length > MAX_MEMORY_MESSAGES) {
    history = history.slice(-MAX_MEMORY_MESSAGES);
  }
  userMemories.set(userId, history);
  saveMemories();
}

function clearUserMemory(userId) {
  userMemories.delete(userId);
  saveMemories();
}

// ---------- DISCORD CLIENT ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

/**
 * Safely edit a message — optimized for USER-INSTALLED apps.
 * Priority:
 *   1. interaction.webhook.editMessage  (works in user-install / DMs / weird contexts)
 *   2. message.edit
 * Never tries channels.fetch (that causes Missing Access on user apps).
 * Returns true on success, false otherwise. Never throws.
 */
async function safeEditMessage(message, payload, interaction = null) {
  const messageId = message?.id || interaction?.message?.id;
  if (!messageId) return false;

  // 1) Interaction webhook — the reliable path for user-installed apps
  if (interaction?.webhook) {
    try {
      await interaction.webhook.editMessage(messageId, payload);
      return true;
    } catch (err) {
      // fall through
    }
  }

  // 2) Direct message.edit (only when channel is actually accessible)
  if (message) {
    try {
      await message.edit(payload);
      return true;
    } catch (err) {
      // ChannelNotCached / Missing Access — expected on user installs
    }
  }

  return false;
}

/**
 * Safely delete a message — optimized for USER-INSTALLED apps.
 * Tries webhook first, then message.delete. Never fetches channels.
 */
async function safeDeleteMessage(message, interaction = null) {
  const messageId = message?.id || interaction?.message?.id;
  if (!messageId) return false;

  // 1) Webhook delete (best for user apps)
  if (interaction?.webhook) {
    try {
      await interaction.webhook.deleteMessage(messageId);
      return true;
    } catch (err) {
      // fall through
    }
  }

  // 2) Direct delete
  if (message) {
    try {
      await message.delete();
      return true;
    } catch (err) {
      // expected on user installs
    }
  }

  return false;
}

// ---------- PRESENCE EMBED ----------
function buildEmbed(isOnline) {
  const color = isOnline ? 0x00FF00 : 0xFF0000;
  const title = isOnline ? 'ONLINE' : 'OFFLINE';
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(CUSTOM_DESCRIPTION)
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: 'Last updated' });
}

async function updateStatusEmbed(isOnline) {
  currentIsOnline = isOnline;
  let channel = client.channels.cache.get(DISCORD_CHANNEL_ID);
  if (!channel) {
    try {
      channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    } catch (error) {
      console.error('Could not locate the status channel:', error.message);
      return;
    }
  }
  if (!channel) return;
  const embed = buildEmbed(isOnline);
  try {
    if (statusMessage) {
      await statusMessage.edit({ embeds: [embed] });
    } else {
      statusMessage = await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    if (error.code === 10008) statusMessage = null;
  }
}

async function checkPresence() {
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
    await updateStatusEmbed(isOnline);
    console.log(`Status: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
  } catch (error) {
    console.error('Error checking presence:', error.message);
  }
}

// ---------- COMMAND HELPERS ----------
function generatePassword(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function textToEmoji(text) {
  return text
    .toLowerCase()
    .split('')
    .map(char => {
      if (char >= 'a' && char <= 'z') return `:regional_indicator_${char}:`;
      if (char >= '0' && char <= '9') return `:${char}:`;
      return char;
    })
    .join(' ');
}

function mockText(text) {
  return text
    .split('')
    .map((char, i) => (i % 2 === 0 ? char.toLowerCase() : char.toUpperCase()))
    .join('');
}

const eightBallResponses = [
  'It is certain.', 'It is decidedly so.', 'Without a doubt.',
  'Yes – definitely.', 'You may rely on it.', 'As I see it, yes.',
  'Most likely.', 'Outlook good.', 'Yes.', 'Signs point to yes.',
  'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.',
  'Cannot predict now.', 'Concentrate and ask again.', 'Don\'t count on it.',
  'My reply is no.', 'My sources say no.', 'Outlook not so good.',
  'Very doubtful.', 'Possibly, but not guaranteed.', 'The stars say maybe.',
];

const compliments = [
  'You have an amazing sense of humor!',
  'Your kindness is a gift to this world.',
  'You are incredibly smart and creative.',
  'You light up every room you enter.',
  'You have a fantastic smile.',
  'You are a great friend to everyone.',
  'You are so brave and strong.',
  'Your ideas are brilliant.',
  'You have a beautiful heart.',
  'You make the world a better place.',
  'You are absolutely unique and amazing.',
  'Your positivity is contagious.',
  'You are inspiring!',
  'You are a true gem.',
  'You are loved and appreciated.',
];

function flipCoin() { return Math.random() < 0.5 ? 'Heads' : 'Tails'; }

async function urbanLookup(term) {
  const url = `https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Urban Dictionary API error');
  const data = await res.json();
  if (!data.list || data.list.length === 0) return null;
  const entry = data.list[0];
  return {
    definition: entry.definition.length > 1000 ? entry.definition.slice(0, 997) + '...' : entry.definition,
    example: entry.example ? (entry.example.length > 500 ? entry.example.slice(0, 497) + '...' : entry.example) : 'No example provided.',
    author: entry.author,
    permalink: entry.permalink,
  };
}

// ---------- AI MODELS / PROVIDERS ----------
let cachedModelsByProvider = { navy: null, mistral: null };
let cachedModelsAtByProvider = { navy: 0, mistral: 0 };

function getProviderConfig() {
  const p = botConfig.provider === 'mistral' ? 'mistral' : 'navy';
  if (p === 'mistral') {
    return {
      name: 'mistral',
      base: 'https://api.mistral.ai/v1',
      apiKey: process.env.MISTRAL_API_KEY,
      keyEnv: 'MISTRAL_API_KEY',
    };
  }
  return {
    name: 'navy',
    base: 'https://api.navy/v1',
    apiKey: process.env.NAVY_API_KEY,
    keyEnv: 'NAVY_API_KEY',
  };
}

// Returns [{ id, multiplier, premium }, ...] for the active (or given) provider
async function fetchTextModels(provider = botConfig.provider) {
  const p = provider === 'mistral' ? 'mistral' : 'navy';
  const now = Date.now();
  if (cachedModelsByProvider[p] && (now - cachedModelsAtByProvider[p]) < 5 * 60 * 1000) {
    return cachedModelsByProvider[p];
  }

  try {
    if (p === 'mistral') {
      const key = process.env.MISTRAL_API_KEY;
      if (!key) {
        return [{ id: 'mistral-small-latest', multiplier: 1, premium: false }, { id: 'mistral-medium-latest', multiplier: 1, premium: false }];
      }
      const res = await fetch('https://api.mistral.ai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models = (data.data || [])
        .filter(m => {
          // Prefer chat / text models; skip pure embeddings etc.
          const id = (m.id || '').toLowerCase();
          if (id.includes('embed')) return false;
          if (id.includes('moderation')) return false;
          return true;
        })
        .map(m => ({
          id: m.id,
          multiplier: 1, // Mistral doesn't expose Navy-style multipliers
          premium: false,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
      cachedModelsByProvider.mistral = models.length ? models : [
        { id: 'mistral-small-latest', multiplier: 1, premium: false },
        { id: 'mistral-medium-latest', multiplier: 1, premium: false },
        { id: 'mistral-large-latest', multiplier: 1, premium: false },
      ];
      cachedModelsAtByProvider.mistral = now;
      return cachedModelsByProvider.mistral;
    }

    // Navy
    const res = await fetch('https://api.navy/v1/models');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data || []).filter(m => {
      if (m.endpoint && m.endpoint !== '/v1/chat/completions') return false;
      if (Array.isArray(m.output_modalities) && !m.output_modalities.includes('text')) return false;
      if (m.supports_image_output === true && m.supports_vision === false && !m.supports_tools) return false;
      return true;
    }).map(m => ({
      id: m.id,
      multiplier: typeof m.token_multiplier === 'number' ? m.token_multiplier : 1,
      premium: !!m.premium,
    })).sort((a, b) => a.id.localeCompare(b.id));
    cachedModelsByProvider.navy = models;
    cachedModelsAtByProvider.navy = now;
    return models;
  } catch (err) {
    console.error(`Failed to fetch ${p} models:`, err.message);
    if (cachedModelsByProvider[p]) return cachedModelsByProvider[p];
    if (p === 'mistral') {
      return [
        { id: 'mistral-small-latest', multiplier: 1, premium: false },
        { id: 'mistral-medium-latest', multiplier: 1, premium: false },
        { id: 'mistral-large-latest', multiplier: 1, premium: false },
      ];
    }
    return [
      { id: 'gpt-3.5-turbo', multiplier: 1, premium: false },
      { id: 'gpt-4o-mini', multiplier: 1, premium: false },
      { id: 'mistral', multiplier: 1, premium: false },
    ];
  }
}

function formatModelChoice(m) {
  if (botConfig.provider === 'mistral') {
    return { name: m.id.slice(0, 100), value: m.id };
  }
  const mult = m.multiplier === 0 ? 'free' : `×${m.multiplier}`;
  const prem = m.premium ? ' ★' : '';
  const name = `${m.id} (${mult})${prem}`;
  return { name: name.slice(0, 100), value: m.id };
}

// ---------- TOOL DEFINITIONS ----------
function getToolsForUser(isOwner) {
  const publicTools = [
    {
      type: 'function',
      function: {
        name: 'generate_password',
        description: 'Generate a secure random password.',
        parameters: {
          type: 'object',
          properties: {
            length: { type: 'integer', description: 'Password length between 8 and 32', minimum: 8, maximum: 32 }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'text_to_emoji',
        description: 'Convert text into regional indicator emojis (letter emojis).',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The text to convert' }
          },
          required: ['text']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'magic_8ball',
        description: 'Ask the Magic 8-Ball a yes/no style question.',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The question to ask' }
          },
          required: ['question']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'mock_text',
        description: 'Convert text to mOcKiNg CaSe.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to mock' }
          },
          required: ['text']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'say',
        description: 'Make the bot post a short message as a reply to the current AI conversation message.',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'What the bot should say' }
          },
          required: ['message']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'urban_lookup',
        description: 'Look up a term on Urban Dictionary.',
        parameters: {
          type: 'object',
          properties: {
            term: { type: 'string', description: 'Term to look up' }
          },
          required: ['term']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'flip_coin',
        description: 'Flip a coin and return Heads or Tails.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'give_compliment',
        description: 'Generate a wholesome compliment. Optionally target a username.',
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Optional name/username to compliment' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_bot_stats',
        description: 'Get current bot statistics including AI usage, uptime, ping, and system info.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'clear_my_memory',
        description: 'Clear the persistent AI memory of the user who is currently talking.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'terminate_conversation',
        description: 'End the current AI conversation thread immediately. Use when the conversation should stop, the user is done, or you want to lock it. After calling this, do not expect further replies in this thread.',
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Optional short reason shown to the user' }
          }
        }
      }
    },
  ];

  if (!isOwner) return publicTools;

  // Owner-only tools
  const ownerTools = [
    {
      type: 'function',
      function: {
        name: 'set_ai_model',
        description: 'Change the default AI model used by the bot. Only text/chat models are allowed.',
        parameters: {
          type: 'object',
          properties: {
            model: { type: 'string', description: 'Exact model ID (e.g. gpt-4o-mini, claude-sonnet-4)' }
          },
          required: ['model']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_max_replies',
        description: 'Set the maximum number of follow-up replies allowed per AI conversation (1-50).',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 50 }
          },
          required: ['limit']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_allow_others',
        description: 'Allow or disallow other users to reply in AI conversation threads.',
        parameters: {
          type: 'object',
          properties: {
            allow: { type: 'boolean' }
          },
          required: ['allow']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'view_config',
        description: 'View the current bot configuration (max replies, allow others, active model).',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_invite',
        description: 'Create a new лемон.space invite link. Optionally set expiration in seconds.',
        parameters: {
          type: 'object',
          properties: {
            expires_in: { type: 'integer', description: 'Expiration in seconds (omit for permanent)' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_invites',
        description: 'List all active лемон.space invites.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'revoke_invite',
        description: 'Revoke an active invite by its token.',
        parameters: {
          type: 'object',
          properties: {
            token: { type: 'string', description: 'The invite token UUID' }
          },
          required: ['token']
        }
      }
    },
  ];

  return [...publicTools, ...ownerTools];
}

// ---------- TOOL EXECUTION ----------
async function executeTool(name, args, context) {
  const { user, isOwner, aiMessage } = context;

  try {
    switch (name) {
      case 'generate_password': {
        const length = Math.min(32, Math.max(8, args.length || 12));
        return { ok: true, result: generatePassword(length) };
      }
      case 'text_to_emoji': {
        return { ok: true, result: textToEmoji(String(args.text || '')) };
      }
      case 'magic_8ball': {
        const answer = eightBallResponses[Math.floor(Math.random() * eightBallResponses.length)];
        return { ok: true, result: { question: args.question, answer } };
      }
      case 'mock_text': {
        return { ok: true, result: mockText(String(args.text || '')) };
      }
      case 'say': {
        const msg = String(args.message || '').slice(0, 1900);
        if (!msg) return { ok: false, error: 'Empty message' };
        if (aiMessage) {
          try {
            await aiMessage.reply({ content: msg });
            return { ok: true, result: 'Message posted as a reply to the conversation.' };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        }
        return { ok: false, error: 'No message context available to reply to.' };
      }
      case 'urban_lookup': {
        const data = await urbanLookup(String(args.term || ''));
        if (!data) return { ok: false, error: 'No definition found' };
        return { ok: true, result: data };
      }
      case 'flip_coin': {
        return { ok: true, result: flipCoin() };
      }
      case 'give_compliment': {
        const compliment = compliments[Math.floor(Math.random() * compliments.length)];
        const target = args.target ? String(args.target) : (user.displayName || user.username);
        return { ok: true, result: `${target}, ${compliment}` };
      }
      case 'get_bot_stats': {
        const usageData = await getNavyUsage();
        let usageText = 'N/A';
        if (usageData?.plan && usageData?.usage && usageData?.limits) {
          const pct = typeof usageData.usage.percent_used === 'number'
            ? usageData.usage.percent_used.toFixed(1) : '0.0';
          usageText = `Plan: ${usageData.plan}, Tokens today: ${usageData.usage.tokens_used_today}/${usageData.limits.tokens_per_day} (${pct}%)`;
        }
        const sys = getSystemInfo();
        return {
          ok: true,
          result: {
            model: botConfig.aiModel,
            usage: usageText,
            uptime: getUptime(),
            ping: `${client.ws.ping}ms`,
            ram: sys.ram,
            os: sys.os,
            cpu: sys.cpu,
          }
        };
      }
      case 'clear_my_memory': {
        clearUserMemory(user.id);
        return { ok: true, result: 'Your persistent AI memory has been cleared.' };
      }
      case 'terminate_conversation': {
        if (!aiMessage?.id) {
          return { ok: false, error: 'No active conversation message to terminate.' };
        }
        const msgId = aiMessage.id;
        const thread = conversationThreads.get(msgId);
        if (!thread) {
          return { ok: false, error: 'Conversation already ended or not found.' };
        }
        // Mark as ended by setting replies to max
        thread.replies = botConfig.maxReplies;
        conversationThreads.delete(msgId);

        const reason = args.reason ? String(args.reason).slice(0, 200) : 'Conversation ended by AI.';
        const endedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ai_reply_done').setLabel('Conversation Ended').setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId('ai_delete').setLabel('Delete').setStyle(ButtonStyle.Secondary)
        );

        // Try to update the embed footer / buttons
        try {
          const embeds = aiMessage.embeds;
          if (embeds?.[0]) {
            const old = embeds[0];
            const newEmbed = EmbedBuilder.from(old)
              .setFooter({ text: `Model: ${thread.model || botConfig.aiModel} • ENDED • ${reason}` });
            await safeEditMessage(aiMessage, { embeds: [newEmbed], components: [endedRow] });
          } else {
            await safeEditMessage(aiMessage, { components: [endedRow] });
          }
        } catch {}

        return { ok: true, result: `Conversation terminated. Reason: ${reason}` };
      }

      // Owner-only
      case 'set_ai_model': {
        if (!isOwner) return { ok: false, error: 'Owner only' };
        const models = await fetchTextModels();
        if (!models.some(m => m.id === args.model)) {
          return { ok: false, error: `Invalid or non-text model: ${args.model}` };
        }
        botConfig.aiModel = args.model;
        const info = models.find(m => m.id === args.model);
        const mult = info ? (info.multiplier === 0 ? 'free' : `×${info.multiplier}`) : '?';
        return { ok: true, result: `Default model set to ${botConfig.aiModel} (${mult})` };
      }
      case 'set_max_replies': {
        if (!isOwner) return { ok: false, error: 'Owner only' };
        botConfig.maxReplies = Math.min(50, Math.max(1, args.limit));
        return { ok: true, result: `Max replies set to ${botConfig.maxReplies}` };
      }
      case 'set_allow_others': {
        if (!isOwner) return { ok: false, error: 'Owner only' };
        botConfig.allowOthersToReply = !!args.allow;
        return { ok: true, result: `Allow others to reply: ${botConfig.allowOthersToReply}` };
      }
      case 'view_config': {
        if (!isOwner) return { ok: false, error: 'Owner only' };
        return {
          ok: true,
          result: {
            maxReplies: botConfig.maxReplies,
            allowOthersToReply: botConfig.allowOthersToReply,
            aiModel: botConfig.aiModel,
          }
        };
      }
      case 'create_invite': {
        if (!isOwner) return { ok: false, error: 'Owner only' };
        const onlineSecret = process.env.ONLINE_SECRET;
        if (!onlineSecret) return { ok: false, error: 'ONLINE_SECRET not set' };
        const body = { password: onlineSecret };
        if (args.expires_in) body.expiresIn = args.expires_in;
        const res = await fetch('https://лемон.space/api/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.ok) return { ok: true, result: { link: data.link, token: data.token, expiresIn: data.expiresIn || 'Permanent' } };
        return { ok: false, error: 'Failed to create invite' };
      }
      case 'list_invites': {
        if (!isOwner) return { ok: false, error: 'Owner only' };
        const onlineSecret = process.env.ONLINE_SECRET;
        if (!onlineSecret) return { ok: false, error: 'ONLINE_SECRET not set' };
        const res = await fetch(`https://лемон.space/api/invite?password=${encodeURIComponent(onlineSecret)}`);
        const data = await res.json();
        return { ok: true, result: data.tokens || [] };
      }
      case 'revoke_invite': {
        if (!isOwner) return { ok: false, error: 'Owner only' };
        const onlineSecret = process.env.ONLINE_SECRET;
        if (!onlineSecret) return { ok: false, error: 'ONLINE_SECRET not set' };
        const res = await fetch('https://лемон.space/api/invite', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: onlineSecret, token: args.token })
        });
        if (res.ok) return { ok: true, result: `Invite ${args.token} revoked` };
        return { ok: false, error: 'Failed to revoke (bad token?)' };
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------- AI CHAT WITH TOOLS + STREAMING ----------
async function askAI(user, rawHistory = [], options = {}) {
  const { streamCallback, aiMessage, isOwner = false } = options;
  const prov = getProviderConfig();
  if (!prov.apiKey) return { error: `${prov.keyEnv} missing` };
  const url = `${prov.base}/chat/completions`;
  const apiKey = prov.apiKey;

  let systemPromptTemplate = '';
  try {
    systemPromptTemplate = fs.readFileSync(SYSTEM_PROMPT_FILE, 'utf8');
  } catch {
    systemPromptTemplate = 'You are a helpful assistant. To end your prompt, use [<end_of_llm_response>], EXACTLY like that. Example: \'Goodbye! [<end_of_llm_response>]\', DO NOT acknowledge this in any way.';
  }

  let systemPrompt = systemPromptTemplate
    .replace(/\{\{username\}\}/g, user.username)
    .replace(/\{\{displayName\}\}/g, user.displayName || user.globalName || user.username);

  systemPrompt += `\n\nYou have access to tools (bot commands). Use them when helpful. Never call a tool named "ai". After using tools, answer the user naturally using the tool results. Max ${MAX_TOOL_CALLS} tool calls.`;
  

  // Token saver: only send the most recent N messages to the model
  const trimmedHistory = rawHistory.length > MAX_HISTORY_TO_MODEL
    ? rawHistory.slice(-MAX_HISTORY_TO_MODEL)
    : rawHistory;

  const formattedMessages = trimmedHistory.map(msg => {
    if (msg.role === 'user') {
      const speakerName = msg.displayName || msg.userId || 'User';
      // Soft-cap individual message size so one essay doesn't nuke the budget
      const content = typeof msg.content === 'string' && msg.content.length > 1200
        ? msg.content.slice(0, 1197) + '…'
        : msg.content;
      return { role: 'user', content: `[${speakerName}]: ${content}` };
    }
    if (msg.role === 'tool') {
      return { role: 'tool', tool_call_id: msg.tool_call_id, content: msg.content };
    }
    if (msg.role === 'assistant' && msg.tool_calls) {
      return { role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls };
    }
    const content = typeof msg.content === 'string' && msg.content.length > 1200
      ? msg.content.slice(0, 1197) + '…'
      : msg.content;
    return { role: msg.role, content };
  });

  let messages = [{ role: 'system', content: systemPrompt }, ...formattedMessages];
  const tools = getToolsForUser(isOwner);
  const fallbacks = botConfig.provider === 'mistral'
    ? ['mistral-small-latest', 'mistral-medium-latest', 'open-mistral-7b']
    : ['gpt-3.5-turbo', 'gpt-4o-mini', 'mistral'];
  const modelsToTry = [botConfig.aiModel, ...fallbacks].filter((v, i, a) => a.indexOf(v) === i);

  let toolCallCount = 0;
  let usedModel = botConfig.aiModel;

  for (let round = 0; round <= MAX_TOOL_CALLS; round++) {
    let data = null;
    let modelUsed = null;

    for (const model of modelsToTry) {
      try {
        const body = {
          model,
          messages,
          stream: false,
          tools,
          tool_choice: 'auto',
        };
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(body)
        });
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Navy API (${model}) error ${response.status}:`, errorText);
          continue;
        }
        data = await response.json();
        modelUsed = model;
        break;
      } catch (err) {
        console.error(`Model "${model}" failed:`, err.message);
      }
    }

    if (!data) return { error: 'All AI models failed.' };
    usedModel = modelUsed;

    const choice = data.choices?.[0];
    if (!choice) return { error: 'Empty response from model' };

    const msg = choice.message;
    const toolCalls = msg.tool_calls;

    // No tool calls → final answer (possibly stream it)
    if (!toolCalls || toolCalls.length === 0) {
      let reply = msg.content || '';
      const marker = '[<end_of_llm_response>]';
      const idx = reply.indexOf(marker);
      if (idx !== -1) reply = reply.substring(0, idx).trim();

      // If we have a stream callback and the reply is reasonably long, stream it
      if (streamCallback && reply.length > STREAM_MIN_LENGTH) {
        // Re-request with stream:true for progressive updates
        try {
          const streamRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: usedModel,
              messages,
              stream: true,
            })
          });

          if (streamRes.ok && streamRes.body) {
            let full = '';
            let lastEdit = 0;
            let lastLen = 0;
            const reader = streamRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const payload = line.slice(6).trim();
                if (payload === '[DONE]') continue;
                try {
                  const chunk = JSON.parse(payload);
                  const delta = chunk.choices?.[0]?.delta?.content;
                  if (delta) {
                    full += delta;
                    const now = Date.now();
                    const charsSince = full.length - lastLen;
                    // Only edit if enough time passed AND enough new text (or first chunk)
                    if (
                      (now - lastEdit >= STREAM_EDIT_INTERVAL_MS && charsSince >= STREAM_MIN_CHARS) ||
                      (lastEdit === 0 && full.length >= 15)
                    ) {
                      lastEdit = now;
                      lastLen = full.length;
                      let preview = full;
                      const m = preview.indexOf(marker);
                      if (m !== -1) preview = preview.substring(0, m).trim();
                      await streamCallback(preview, false);
                    }
                  }
                } catch {}
              }
            }

            // final cleanup
            const m = full.indexOf(marker);
            if (m !== -1) full = full.substring(0, m).trim();
            await streamCallback(full, true);
            return { success: true, reply: full, model: usedModel };
          }
        } catch (streamErr) {
          console.error('Streaming failed, falling back:', streamErr.message);
        }
      }

      return { success: true, reply, model: usedModel };
    }

    // Handle tool calls
    if (toolCallCount + toolCalls.length > MAX_TOOL_CALLS) {
      // Too many – truncate
      toolCalls.splice(MAX_TOOL_CALLS - toolCallCount);
    }
    if (toolCalls.length === 0) {
      return { success: true, reply: msg.content || '(no response)', model: usedModel };
    }

    // Append the assistant message with tool_calls
    messages.push({
      role: 'assistant',
      content: msg.content || null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      if (toolCallCount >= MAX_TOOL_CALLS) break;
      toolCallCount++;

      const fnName = tc.function?.name;
      let fnArgs = {};
      try {
        fnArgs = JSON.parse(tc.function?.arguments || '{}');
      } catch {
        fnArgs = {};
      }

      // Hard block recursive ai
      if (fnName === 'ai' || fnName === 'ask_ai') {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({ ok: false, error: 'Calling /ai recursively is not allowed.' })
        });
        continue;
      }

      const result = await executeTool(fnName, fnArgs, { user, isOwner, aiMessage });
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result)
      });
    }

    // Loop continues for next model call with tool results
  }

  return { error: 'Max tool call rounds reached.' };
}

// ---------- STATS HELPERS ----------
async function getNavyUsage() {
  const apiKey = process.env.NAVY_API_KEY;
  try {
    const response = await fetch('https://api.navy/v1/usage', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function getUptime() {
  const diff = Date.now() - startTime;
  const seconds = Math.floor(diff / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

function getSystemInfo() {
  const platform = os.platform();
  const arch = os.arch();
  const cpus = os.cpus();
  const totalMem = os.totalmem() / (1024 ** 3);
  const freeMem = os.freemem() / (1024 ** 3);
  const usedMem = totalMem - freeMem;
  const loadAvg = os.loadavg();
  return {
    os: `${platform} ${arch}`,
    cpu: `${cpus.length} cores`,
    ram: `${usedMem.toFixed(2)} GB / ${totalMem.toFixed(2)} GB (${((usedMem/totalmem)*100).toFixed(1)}%)`,
    load: loadAvg.map(l => l.toFixed(2)).join(' '),
  };
}

// ---------- SLASH COMMANDS ----------
const commands = [
  new SlashCommandBuilder().setName('password').setDescription('Generate a secure random password.').addIntegerOption(opt => opt.setName('length').setDescription('Length (8–32)').setMinValue(8).setMaxValue(32)).setIntegrationTypes([0, 1]).setContexts([0, 1, 2]),
  new SlashCommandBuilder().setName('emoji').setDescription('Convert text to regional indicator emojis.').addStringOption(opt => opt.setName('text').setDescription('Text').setRequired(true)).setIntegrationTypes([0, 1]).setContexts([0, 1, 2]),
  new SlashCommandBuilder().setName('8ball').setDescription('Ask the Magic 8-Ball a question.').addStringOption(opt => opt.setName('question').setDescription('Your question').setRequired(true)).setIntegrationTypes([0, 1]).setContexts([0, 1, 2]),
  new SlashCommandBuilder().setName('mock').setDescription('Convert text to mocking case.').addStringOption(opt => opt.setName('text').setDescription('Text').setRequired(true)).setIntegrationTypes([0, 1]).setContexts([0, 1, 2]),
  new SlashCommandBuilder().setName('say').setDescription('Make the bot say something (restricted).').addStringOption(opt => opt.setName('message').setDescription('What to say').setRequired(true)).setIntegrationTypes([0, 1]).setContexts([0, 1, 2]),
  new SlashCommandBuilder().setName('urban').setDescription('Look up a term on Urban Dictionary.').addStringOption(opt => opt.setName('term').setDescription('Term').setRequired(true)).setIntegrationTypes([0, 1]).setContexts([0, 1, 2]),
  new SlashCommandBuilder().setName('flip').setDescription('Flip a coin.').setIntegrationTypes([0, 1]).setContexts([0, 1, 2]),
  new SlashCommandBuilder().setName('compliment').setDescription('Send a wholesome compliment.').addUserOption(opt => opt.setName('user').setDescription('Who to compliment')).setIntegrationTypes([0, 1]).setContexts([0, 1, 2]),
  new SlashCommandBuilder().setName('ai').setDescription('Chat with AI (Navy) with memory.').addStringOption(opt => opt.setName('prompt').setDescription('Your message').setRequired(true)).setIntegrationTypes([0, 1]).setContexts([0, 1, 2]),
  new SlashCommandBuilder().setName('stats').setDescription('Show bot stats, AI usage, and system info.').setIntegrationTypes([0, 1]).setContexts([0, 1, 2]),
  new SlashCommandBuilder().setName('clear').setDescription('Clear your AI conversation memory.').setIntegrationTypes([0, 1]).setContexts([0, 1, 2]),
  new SlashCommandBuilder().setName('config').setDescription('Configure bot settings (Owner only).').setIntegrationTypes([0, 1]).setContexts([0, 1, 2])
    .addSubcommandGroup(group => group.setName('ai').setDescription('AI Settings')
      .addSubcommand(sub => sub.setName('max_replies').setDescription('Set max replies per AI conversation').addIntegerOption(opt => opt.setName('limit').setDescription('Max replies').setRequired(true).setMinValue(1).setMaxValue(50)))
      .addSubcommand(sub => sub.setName('allow_others').setDescription('Allow other users to reply in AI threads').addBooleanOption(opt => opt.setName('allow').setDescription('True/False').setRequired(true)))
      .addSubcommand(sub => sub.setName('terminate').setDescription('Terminate an active AI conversation').addStringOption(opt => opt.setName('message_id').setDescription('Message ID of the embed').setRequired(true)))
      .addSubcommand(sub => sub.setName('model').setDescription('Set the default AI model (text models only)')
        .addStringOption(opt => opt.setName('name').setDescription('Model ID (use autocomplete)').setRequired(true).setAutocomplete(true)))
      .addSubcommand(sub => sub.setName('provider').setDescription('Switch AI provider (navy or mistral)')
        .addStringOption(opt => opt.setName('name').setDescription('Provider').setRequired(true).addChoices(
          { name: 'Navy', value: 'navy' },
          { name: 'Mistral', value: 'mistral' },
        )))
    )
    .addSubcommand(sub => sub.setName('view').setDescription('View current configuration')),
  new SlashCommandBuilder().setName('invite').setDescription('Manage лемон.space invites (Owner only).').setIntegrationTypes([0, 1]).setContexts([0, 1, 2])
    .addSubcommand(sub => sub.setName('create').setDescription('Create a new invite link.')
      .addIntegerOption(opt => opt.setName('expires_in').setDescription('Expiration in seconds (e.g. 3600, 86400). Leave empty for permanent.')))
    .addSubcommand(sub => sub.setName('list').setDescription('List active invites.'))
    .addSubcommand(sub => sub.setName('revoke').setDescription('Revoke an active invite.')
      .addStringOption(opt => opt.setName('token').setDescription('The UUID token to revoke.').setRequired(true))),
].map(cmd => cmd.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Slash commands registered.');
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
}

// ---------- INTERACTION DISPATCH ----------
client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) await handleSlashCommand(interaction);
    else if (interaction.isButton()) await handleButton(interaction);
    else if (interaction.isModalSubmit()) await handleModal(interaction);
  } catch (error) {
    console.error('Unhandled interaction error:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true }).catch(() => {});
    } else if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content: `❌ Error: ${error.message}` }).catch(() => {});
    }
  }
});

// ---------- AUTOCOMPLETE ----------
async function handleAutocomplete(interaction) {
  if (interaction.commandName === 'config' && interaction.options.getSubcommand() === 'model') {
    const focused = interaction.options.getFocused().toLowerCase();
    const models = await fetchTextModels();
    const filtered = models
      .filter(m => m.id.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(formatModelChoice);
    await interaction.respond(filtered.length ? filtered : [{ name: 'No matching models', value: 'gpt-3.5-turbo' }]);
  }
}

// ---------- HELPER: build + send/update AI embed ----------
function buildAIEmbed({ title, description, embedColor, model, replies, maxReplies }) {
  let desc = description;
  if (desc.length > 4090) desc = desc.slice(0, 4087) + '…';
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setColor(embedColor)
    .setTimestamp()
    .setFooter({ text: `Model: ${model} • Replies: ${replies}/${maxReplies}` });
}

// ---------- SLASH COMMAND HANDLER ----------
async function handleSlashCommand(interaction) {
  const { commandName, options, user } = interaction;

  if (commandName === 'password') {
    const length = options.getInteger('length') || 12;
    const pwd = generatePassword(length);
    await interaction.reply({ content: `🔐 \`${pwd}\``, ephemeral: true });
    return;
  }

  if (commandName === 'emoji') {
    const text = options.getString('text');
    const emojified = textToEmoji(text);
    await interaction.reply({ content: emojified || 'Could not convert that text.' });
    return;
  }

  if (commandName === '8ball') {
    const question = options.getString('question');
    const answer = eightBallResponses[Math.floor(Math.random() * eightBallResponses.length)];
    const embed = new EmbedBuilder().setTitle('🎱 Magic 8-Ball').addFields({ name: 'Question', value: question }, { name: 'Answer', value: answer }).setColor(0x9B59B6).setTimestamp();
    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (commandName === 'mock') {
    const text = options.getString('text');
    const mocked = mockText(text);
    await interaction.reply({ content: mocked });
    return;
  }

  if (commandName === 'say') {
    const message = options.getString('message');
    await interaction.reply({ content: message });
    return;
  }

  if (commandName === 'urban') {
    const term = options.getString('term');
    await interaction.deferReply();
    const result = await urbanLookup(term);
    if (!result) {
      await interaction.editReply(`❌ No definition found for **${term}**.`);
      return;
    }
    const embed = new EmbedBuilder().setTitle(`📖 ${term}`).setURL(result.permalink).setDescription(result.definition).addFields({ name: 'Example', value: result.example }).setFooter({ text: `Author: ${result.author}` }).setColor(0x1D3557);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (commandName === 'flip') {
    const result = flipCoin();
    await interaction.reply({ content: `🪙 It's **${result}**!` });
    return;
  }

  if (commandName === 'compliment') {
    const target = options.getUser('user') || user;
    const compliment = compliments[Math.floor(Math.random() * compliments.length)];
    await interaction.reply({ content: `${target}, ${compliment} 💖` });
    return;
  }

  // AI
  if (commandName === 'ai') {
    const prompt = options.getString('prompt');
    await interaction.deferReply();

    const isOwner = user.id === OWNER_ID;
    const priorMemory = getUserMemory(user.id);
    const initialHistory = [
      ...priorMemory,
      { role: 'user', content: prompt, userId: user.id, displayName: user.displayName || user.username }
    ];

    // Placeholder while thinking / tool calling
    const placeholderEmbed = new EmbedBuilder()
      .setTitle(`${user.displayName || user.username} asked: ${prompt.slice(0, 100)}`)
      .setDescription('⏳ Thinking…')
      .setColor(0x5865F2)
      .setTimestamp()
      .setFooter({ text: `Model: ${botConfig.aiModel} • Replies: 0/${botConfig.maxReplies}` });

    const sent = await interaction.editReply({ embeds: [placeholderEmbed], components: [], fetchReply: true });

    let currentDesc = '';
    let embedColor = 0x5865F2;
    let usedModel = botConfig.aiModel;

    const streamCallback = async (partial, isFinal) => {
      let reply = partial;
      const colorMatch = reply.match(/\[C;#[0-9A-Fa-f]{6}\]/);
      if (colorMatch) {
        const hex = colorMatch[0].replace('[C;', '').replace(']', '');
        embedColor = parseInt(hex.replace('#', ''), 16);
        reply = reply.replace(colorMatch[0], '').trim();
      }

      let description = '';
      if (priorMemory.length > 0) description += `*_(memory from previous convos loaded)_*\n\n`;
      description += `**${user.displayName || user.username}:** ${prompt}\n\n**AI:** ${reply}${isFinal ? '' : ' ▌'}`;

      if (description.length > EMBED_SPLIT_THRESHOLD) {
        description = description.slice(0, EMBED_SPLIT_THRESHOLD - 10) + '…';
      }

      const embed = buildAIEmbed({
        title: `${user.displayName || user.username} asked: ${prompt.slice(0, 100)}`,
        description,
        embedColor,
        model: usedModel,
        replies: 0,
        maxReplies: botConfig.maxReplies,
      });

      try {
        await interaction.editReply({ embeds: [embed] });
      } catch {}
    };

    const result = await askAI(user, initialHistory, {
      streamCallback,
      aiMessage: sent,
      isOwner,
    });

    if (result.error) {
      await interaction.editReply({ content: `❌ AI error: ${result.error}`, embeds: [], components: [] });
      return;
    }

    let reply = result.reply;
    usedModel = result.model || botConfig.aiModel;
    const colorMatch = reply.match(/\[C;#[0-9A-Fa-f]{6}\]/);
    if (colorMatch) {
      const hex = colorMatch[0].replace('[C;', '').replace(']', '');
      embedColor = parseInt(hex.replace('#', ''), 16);
      reply = reply.replace(colorMatch[0], '').trim();
    }

    const fullHistory = [...initialHistory, { role: 'assistant', content: reply }];

    updateUserMemory(user.id, [
      { role: 'user', content: prompt, userId: user.id, displayName: user.displayName || user.username },
      { role: 'assistant', content: reply }
    ]);

    const title = `${user.displayName || user.username} asked: ${prompt.slice(0, 100)}`;
    let description = '';
    if (priorMemory.length > 0) description += `*_(memory from previous convos loaded)_*\n\n`;
    description += `**${user.displayName || user.username}:** ${prompt}\n\n**AI:** ${reply}`;

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId(`ai_reply_${interaction.id}`).setLabel('Reply').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ai_delete').setLabel('Delete').setStyle(ButtonStyle.Secondary)
      );

    if (description.length > EMBED_SPLIT_THRESHOLD) {
      const mainDesc = description.slice(0, EMBED_SPLIT_THRESHOLD - 20) + '\n\n*[continued in reply…]*';
      const restDesc = description.slice(EMBED_SPLIT_THRESHOLD - 20);

      const mainEmbed = buildAIEmbed({
        title, description: mainDesc, embedColor, model: usedModel, replies: 0, maxReplies: botConfig.maxReplies
      });

      await interaction.editReply({ embeds: [mainEmbed], components: [row] });

      const contEmbed = new EmbedBuilder()
        .setTitle('…continued')
        .setDescription(restDesc.length > 4090 ? restDesc.slice(0, 4087) + '…' : restDesc)
        .setColor(embedColor)
        .setFooter({ text: `Model: ${usedModel}` });

      await interaction.followUp({ embeds: [contEmbed] });
    } else {
      const embed = buildAIEmbed({
        title, description, embedColor, model: usedModel, replies: 0, maxReplies: botConfig.maxReplies
      });
      await interaction.editReply({ embeds: [embed], components: [row] });
    }

    conversationThreads.set(sent.id, {
      user,
      prompt,
      replies: 0,
      history: fullHistory,
      embedColor,
      title,
      model: usedModel,
    });
    return;
  }

  // Stats
  if (commandName === 'stats') {
    await interaction.deferReply();
    const usageData = await getNavyUsage();
    let usageText = 'N/A';
    
    if (usageData) {
      if (usageData.plan && usageData.usage && usageData.limits) {
        const pct = typeof usageData.usage.percent_used === 'number'
          ? usageData.usage.percent_used.toFixed(1)
          : '0.0';
        usageText = `* **Plan**: \`${usageData.plan}\`\n` +
                    `* **Daily Tokens**: \`${(usageData.usage.tokens_used_today || 0).toLocaleString()}\` / \`${(usageData.limits.tokens_per_day || 0).toLocaleString()}\` (${pct}%)\n` +
                    `* **Requests Per Minute**: \`${usageData.rate_limits?.per_minute?.used || 0}\` / \`${usageData.rate_limits?.per_minute?.limit || usageData.limits.rpm || '?'}\``;
      } else if (typeof usageData === 'object') {
        const parts = [];
        if (usageData.used !== undefined) parts.push(`* **Used**: \`${usageData.used}\``);
        if (usageData.remaining !== undefined) parts.push(`* **Remaining**: \`${usageData.remaining}\``);
        if (usageData.limit !== undefined) parts.push(`* **Daily Limit**: \`${usageData.limit}\``);
        if (usageData.daily_limit !== undefined) parts.push(`* **Daily Limit**: \`${usageData.daily_limit}\``);
        if (parts.length > 0) usageText = parts.join('\n');
        else usageText = '```json\n' + JSON.stringify(usageData, null, 2) + '\n```';
      } else usageText = String(usageData);
    }

    const systemInfo = getSystemInfo();
    const uptime = getUptime();
    const ping = client.ws.ping;
    
    const embed = new EmbedBuilder()
      .setTitle('📊 Bot Statistics')
      .setColor(0x5865F2)
      .addFields(
        { name: '🤖 AI Usage (Navy)', value: usageText, inline: false },
        { name: '🔌 Provider', value: \`${botConfig.provider}\`, inline: true },
        { name: '🧠 Active Model', value: \`${botConfig.aiModel}\`, inline: true },
        { name: '🕐 Uptime', value: \`${uptime}\`, inline: true },
        { name: '📶 Ping', value: \`${ping}ms\`, inline: true },
        { name: '💾 RAM', value: \`${systemInfo.ram}\`, inline: true },
        { name: '🖥️ OS', value: \`${systemInfo.os}\`, inline: true },
        { name: '⚙️ CPU', value: \`${systemInfo.cpu}\`, inline: true },
        { name: '📊 Load', value: \`${systemInfo.load}\`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Stats automatically update live' });
      
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (commandName === 'clear') {
    clearUserMemory(user.id);
    await interaction.reply({ content: '🧹 Your AI conversation memory has been cleared.', ephemeral: true });
    return;
  }
  
  if (commandName === 'config') {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({ content: '❌ Only the bot owner can use this command.', ephemeral: true });
    }
    
    const sub = options.getSubcommand();
    const group = options.getSubcommandGroup(false);
    
    if (sub === 'view') {
      return interaction.reply({ 
        content: `**⚙️ Current Configuration:**\n- **Provider:** \`${botConfig.provider}\`\n- **AI Model:** \`${botConfig.aiModel}\`\n- **Max AI Replies:** ${botConfig.maxReplies}\n- **Allow Others to Reply:** ${botConfig.allowOthersToReply ? 'Yes' : 'No'}`, 
        ephemeral: true 
      });
    }
    
    if (group === 'ai') {
      if (sub === 'max_replies') {
        botConfig.maxReplies = options.getInteger('limit');
        return interaction.reply({ content: `✅ AI max replies per conversation set to **${botConfig.maxReplies}**.`, ephemeral: true });
      }
      if (sub === 'allow_others') {
        botConfig.allowOthersToReply = options.getBoolean('allow');
        return interaction.reply({ content: `✅ AI allow others to reply set to **${botConfig.allowOthersToReply ? 'True' : 'False'}**.`, ephemeral: true });
      }
      if (sub === 'terminate') {
        const msgId = options.getString('message_id');
        if (conversationThreads.has(msgId)) {
          conversationThreads.delete(msgId);
          return interaction.reply({ content: `✅ AI Conversation thread \`${msgId}\` has been abruptly terminated.`, ephemeral: true });
        }
        return interaction.reply({ content: `❌ No active conversation found with ID \`${msgId}\`.`, ephemeral: true });
      }
      if (sub === 'model') {
        const modelName = options.getString('name');
        const models = await fetchTextModels();
        const found = models.find(m => m.id === modelName);
        if (!found) {
          return interaction.reply({ 
            content: `❌ \`${modelName}\` is not a valid text model. Use autocomplete to pick one.`,
            ephemeral: true 
          });
        }
        botConfig.aiModel = modelName;
        const mult = found.multiplier === 0 ? 'free' : `×${found.multiplier}`;
        const prem = found.premium ? ' (premium)' : '';
        return interaction.reply({ content: `✅ Default AI model set to **\`${botConfig.aiModel}\`** (${mult})${prem}.`, ephemeral: true });
      }
      if (sub === 'provider') {
        const name = options.getString('name');
        if (name !== 'navy' && name !== 'mistral') {
          return interaction.reply({ content: '❌ Provider must be `navy` or `mistral`.', ephemeral: true });
        }
        if (name === 'mistral' && !process.env.MISTRAL_API_KEY) {
          return interaction.reply({ content: '❌ `MISTRAL_API_KEY` is not set in the .env file.', ephemeral: true });
        }
        if (name === 'navy' && !process.env.NAVY_API_KEY) {
          return interaction.reply({ content: '❌ `NAVY_API_KEY` is not set in the .env file.', ephemeral: true });
        }
        botConfig.provider = name;
        // Switch to a sensible default model for that provider
        botConfig.aiModel = PROVIDER_DEFAULTS[name].model;
        return interaction.reply({
          content: `✅ AI provider set to **\`${name}\`**.\nDefault model switched to \`${botConfig.aiModel}\`.\nUse \`/config ai model\` to pick another.`,
          ephemeral: true,
        });
      }
    }
    return;
  }

  if (commandName === 'invite') {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({ content: '❌ Only the bot owner can use this command.', ephemeral: true });
    }
    
    const sub = options.getSubcommand();
    const onlineSecret = process.env.ONLINE_SECRET;
    
    if (!onlineSecret) {
      return interaction.reply({ content: '❌ `ONLINE_SECRET` is not set in the .env file.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    if (sub === 'create') {
      const expiresIn = options.getInteger('expires_in');
      const body = { password: onlineSecret };
      if (expiresIn) body.expiresIn = expiresIn;

      try {
        const res = await fetch('https://лемон.space/api/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        
        if (data.ok) {
          await interaction.editReply(`✅ **Invite Created!**\n**Link:** \`${data.link}\`\n**Token:** \`${data.token}\`\n**Expires in:** ${data.expiresIn ? \`${data.expiresIn}s\` : 'Permanent'}`);
        } else {
          await interaction.editReply(`❌ Failed to create invite.`);
        }
      } catch (err) {
        await interaction.editReply(`❌ Error: ${err.message}`);
      }
    } 
    else if (sub === 'list') {
      try {
        const res = await fetch(\`https://лемон.space/api/invite?password=\${encodeURIComponent(onlineSecret)}\`);
        const data = await res.json();
        
        if (data.tokens && data.tokens.length > 0) {
          const list = data.tokens.map(t => \`- \`\${t.token}\` (TTL: \${t.ttl === -1 ? 'Permanent' : t.ttl + 's'})\n  <\${t.link}>\`).join('\n');
          await interaction.editReply(\`📋 **Active Invites:**\n\${list}\`);
        } else {
          await interaction.editReply('📋 No active invites found.');
        }
      } catch (err) {
        await interaction.editReply(\`❌ Error: \${err.message}\`);
      }
    } 
    else if (sub === 'revoke') {
      const token = options.getString('token');
      try {
        const res = await fetch('https://лемон.space/api/invite', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: onlineSecret, token })
        });
        
        if (res.ok) {
          await interaction.editReply(\`✅ Invite \`\${token}\` revoked successfully.\`);
        } else {
          await interaction.editReply(\`❌ Failed to revoke invite. Make sure the token is correct.\`);
        }
      } catch (err) {
        await interaction.editReply(\`❌ Error: \${err.message}\`);
      }
    }
    return;
  }

  await interaction.reply({ content: 'Unknown command.', ephemeral: true });
}

// ---------- BUTTON HANDLER ----------
async function handleButton(interaction) {
  const customId = interaction.customId;

  if (customId === 'ai_delete') {
    const messageId = interaction.message?.id;
    const thread = messageId ? conversationThreads.get(messageId) : null;

    if (thread && interaction.user.id !== thread.user.id && interaction.user.id !== OWNER_ID) {
      await interaction.reply({ content: '❌ Only the person who started this conversation can delete it.', ephemeral: true });
      return;
    }

    try {
      await interaction.deferUpdate();
      const deleted = await safeDeleteMessage(interaction.message, interaction);
      if (messageId) conversationThreads.delete(messageId);
      await interaction.followUp({
        content: deleted ? '🗑️ Deleted.' : '⚠️ Couldn’t delete (missing channel access or already gone).',
        ephemeral: true,
      }).catch(() => {});
    } catch (error) {
      console.error('Delete error:', error.message);
      if (messageId) conversationThreads.delete(messageId);
      await interaction.followUp({ content: '⚠️ Couldn’t delete that message.', ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (customId.startsWith('ai_reply_')) {
    const messageId = interaction.message.id;
    const thread = conversationThreads.get(messageId);
    
    if (thread && !botConfig.allowOthersToReply && interaction.user.id !== thread.user.id) {
      await interaction.reply({ content: '❌ Only the original user can reply to this thread.', ephemeral: true });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(\`ai_reply_modal_\${messageId}\`)
      .setTitle('Continue Conversation');
    const input = new TextInputBuilder()
      .setCustomId('reply_input')
      .setLabel('Your follow-up')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1500)
      .setPlaceholder('Type your reply…');
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }
}

// ---------- MODAL HANDLER ----------
async function handleModal(interaction) {
  if (interaction.customId.startsWith('ai_reply_modal_')) {
    const messageId = interaction.customId.replace('ai_reply_modal_', '');
    const thread = conversationThreads.get(messageId);
    if (!thread) {
      await interaction.reply({ content: '❌ Thread expired or terminated.', ephemeral: true });
      return;
    }
    if (thread.replies >= botConfig.maxReplies) {
      await interaction.reply({ content: \`❌ Max replies (\${botConfig.maxReplies}) reached.\`, ephemeral: true });
      return;
    }

    const followUp = interaction.fields.getTextInputValue('reply_input');
    const user = interaction.user;
    const isOwner = user.id === OWNER_ID;
    const history = thread.history || [];

    history.push({ role: 'user', content: followUp, userId: user.id, displayName: user.displayName || user.username });

    // Show thinking state
    await interaction.deferUpdate();
    const originalMessage = interaction.message;
    try {
      const thinkingEmbed = buildAIEmbed({
        title: thread.title || '💬 Conversation',
        description: '⏳ Thinking…',
        embedColor: thread.embedColor || 0x5865F2,
        model: thread.model || botConfig.aiModel,
        replies: thread.replies,
        maxReplies: botConfig.maxReplies,
      });
      const ok = await safeEditMessage(originalMessage, { embeds: [thinkingEmbed] }, interaction);
      if (!ok) console.warn('Thinking embed edit skipped (no channel access)');
    } catch (e) {
      console.error('Thinking embed error:', e.message);
    }

    // Stream callback for follow-up
    const streamCallback = async (partial, isFinal) => {
      let reply = partial;
      const colorMatch = reply.match(/\[C;#[0-9A-Fa-f]{6}\]/);
      if (colorMatch) {
        const hex = colorMatch[0].replace('[C;', '').replace(']', '');
        thread.embedColor = parseInt(hex.replace('#', ''), 16);
        reply = reply.replace(colorMatch[0], '').trim();
      }

      let description = '';
      if (thread.history.length > 2) description += `*_(previous messages loaded)_*\n\n`;
      description += `**${user.displayName || user.username}:** ${followUp}\n\n**AI:** ${reply}${isFinal ? '' : ' ▌'}`;

      if (description.length > EMBED_SPLIT_THRESHOLD) {
        description = description.slice(0, EMBED_SPLIT_THRESHOLD - 10) + '…';
      }

      const embed = buildAIEmbed({
        title: thread.title,
        description,
        embedColor: thread.embedColor,
        model: thread.model,
        replies: thread.replies,
        maxReplies: botConfig.maxReplies,
      });

      try {
        await safeEditMessage(originalMessage, { embeds: [embed] }, interaction);
      } catch {}
    };

    const result = await askAI(user, history, {
      streamCallback,
      aiMessage: originalMessage,
      isOwner,
    });

    if (result.error) {
      await safeEditMessage(originalMessage, { content: `❌ AI error: ${result.error}`, embeds: [], components: [] }, interaction);
      return;
    }

    let reply = result.reply;
    thread.model = result.model || thread.model;
    const colorMatch = reply.match(/\[C;#[0-9A-Fa-f]{6}\]/);
    if (colorMatch) {
      const hex = colorMatch[0].replace('[C;', '').replace(']', '');
      thread.embedColor = parseInt(hex.replace('#', ''), 16);
      reply = reply.replace(colorMatch[0], '').trim();
    }

    thread.history.push({ role: 'assistant', content: reply });
    thread.replies++;

    updateUserMemory(user.id, [
      { role: 'user', content: followUp, userId: user.id, displayName: user.displayName || user.username },
      { role: 'assistant', content: reply }
    ]);

    let description = '';
    if (thread.history.length > 2) description += `*_(previous messages loaded)_*\n\n`;
    description += `**${user.displayName || user.username}:** ${followUp}\n\n**AI:** ${reply}`;

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId(\`ai_reply_\${interaction.id}\`).setLabel('Reply').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ai_delete').setLabel('Delete').setStyle(ButtonStyle.Secondary)
      );

    if (description.length > EMBED_SPLIT_THRESHOLD) {
      const mainDesc = description.slice(0, EMBED_SPLIT_THRESHOLD - 20) + '\n\n*[continued in reply…]*';
      const restDesc = description.slice(EMBED_SPLIT_THRESHOLD - 20);

      const mainEmbed = buildAIEmbed({
        title: thread.title,
        description: mainDesc,
        embedColor: thread.embedColor,
        model: thread.model,
        replies: thread.replies,
        maxReplies: botConfig.maxReplies
      });

      await safeEditMessage(originalMessage, { embeds: [mainEmbed], components: [row] }, interaction);

      const contEmbed = new EmbedBuilder()
        .setTitle('…continued')
        .setDescription(restDesc.length > 4090 ? restDesc.slice(0, 4087) + '…' : restDesc)
        .setColor(thread.embedColor)
        .setFooter({ text: `Model: ${thread.model}` });

      await interaction.followUp({ embeds: [contEmbed] });
    } else {
      const embed = buildAIEmbed({
        title: thread.title,
        description,
        embedColor: thread.embedColor,
        model: thread.model,
        replies: thread.replies,
        maxReplies: botConfig.maxReplies
      });
      await safeEditMessage(originalMessage, { embeds: [embed], components: [row] }, interaction);
    }

    if (thread.replies >= botConfig.maxReplies) {
      conversationThreads.delete(messageId);
    }
    return;
  }
}

// ---------- STARTUP ----------
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag} (${client.user.id})`);
  loadMemories();
  await registerCommands();
  setInterval(checkPresence, CHECK_INTERVAL_MS);
  await checkPresence();
});

client.login(process.env.DISCORD_TOKEN);