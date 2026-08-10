const os = require('os');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { botConfig } = require('../config');
const {
  safeEditMessage,
  generatePassword,
  textToEmoji,
  mockText,
  eightBallResponses,
  compliments,
  flipCoin,
  urbanLookup,
} = require('../helpers');
const { clearUserMemory } = require('../memory');
const { fetchTextModels } = require('./models');
const { extraToolDefs, executeExtraTool } = require('./extraTools');

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
            length: { type: 'integer', description: 'Password length between 8 and 32', minimum: 8, maximum: 32 },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'text_to_emoji',
        description: 'Convert text into regional indicator emojis (letter emojis).',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string', description: 'The text to convert' } },
          required: ['text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'magic_8ball',
        description: 'Ask the Magic 8-Ball a yes/no style question.',
        parameters: {
          type: 'object',
          properties: { question: { type: 'string', description: 'The question to ask' } },
          required: ['question'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'mock_text',
        description: 'Convert text to mOcKiNg CaSe.',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string', description: 'Text to mock' } },
          required: ['text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'say',
        description: 'Make the bot post a short message as a reply to the current AI conversation message.',
        parameters: {
          type: 'object',
          properties: { message: { type: 'string', description: 'What the bot should say' } },
          required: ['message'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'urban_lookup',
        description: 'Look up a term on Urban Dictionary.',
        parameters: {
          type: 'object',
          properties: { term: { type: 'string', description: 'Term to look up' } },
          required: ['term'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'flip_coin',
        description: 'Flip a coin and return Heads or Tails.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'give_compliment',
        description: 'Generate a wholesome compliment. Optionally target a username.',
        parameters: {
          type: 'object',
          properties: { target: { type: 'string', description: 'Optional name/username to compliment' } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_bot_stats',
        description: 'Get current bot statistics including AI usage, uptime, ping, and system info.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'clear_my_memory',
        description: 'Clear the persistent AI memory of the user who is currently talking.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'terminate_conversation',
        description:
          'End the current AI conversation thread immediately. Use when the conversation should stop, the user is done, or you want to lock it.',
        parameters: {
          type: 'object',
          properties: { reason: { type: 'string', description: 'Optional short reason shown to the user' } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'customize_embed',
        description: 'Customize the embed title and color for the current conversation.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Custom title for the embed' },
            color: { type: 'string', description: 'Hex color code for the embed (optional)' },
          },
        },
      },
    },
    ...extraToolDefs,
  ],

  if (!isOwner) return publicTools;

  const ownerTools = [
    {
      type: 'function',
      function: {
        name: 'set_ai_model',
        description: 'Change the default AI model used by the bot. Only text/chat models are allowed.',
        parameters: {
          type: 'object',
          properties: { model: { type: 'string', description: 'Exact model ID' } },
          required: ['model'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'set_max_replies',
        description: 'Set the maximum number of follow-up replies allowed per AI conversation (1-50).',
        parameters: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } },
          required: ['limit'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'set_allow_others',
        description: 'Allow or disallow other users to reply in AI conversation threads.',
        parameters: {
          type: 'object',
          properties: { allow: { type: 'boolean' } },
          required: ['allow'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'view_config',
        description: 'View the current bot configuration.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_invite',
        description: 'Create a new лемон.space invite link.',
        parameters: {
          type: 'object',
          properties: { expires_in: { type: 'integer', description: 'Expiration in seconds' } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_invites',
        description: 'List all active лемон.space invites.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'revoke_invite',
        description: 'Revoke an active invite by its token.',
        parameters: {
          type: 'object',
          properties: { token: { type: 'string', description: 'The invite token UUID' } },
          required: ['token'],
        },
      },
    },
  ];

  return [...publicTools, ...ownerTools];
}

async function getNavyUsage() {
  const apiKey = process.env.NAVY_API_KEY;
  try {
    const response = await fetch('https://api.navy/v1/usage', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function getSystemInfo() {
  const platform = os.platform();
  const arch = os.arch();
  const cpus = os.cpus();
  const totalMem = os.totalmem() / 1024 ** 3;
  const freeMem = os.freemem() / 1024 ** 3;
  const usedMem = totalMem - freeMem;
  return {
    os: `${platform} ${arch}`,
    cpu: `${cpus.length} cores`,
    ram: `${usedMem.toFixed(2)} GB / ${totalMem.toFixed(2)} GB (${((usedMem / totalMem) * 100).toFixed(1)}%)`,
  };
}

function getGradualColor(replyCount) {
  const colors = [
    '#0099ff', // Blue
    '#ff6600', // Orange
    '#ff00ff', // Purple
    '#00ff00', // Green
    '#ff0000', // Red
    '#ffff00', // Yellow
  ];
  return colors[replyCount % colors.length];
}

async function executeTool(name, args, context) {
  const { user, isOwner, aiMessage, conversationThreads, client, startTime } = context;

  try {
    const extra = await executeExtraTool(name, args, context);
    if (extra !== null) return extra;

    switch (name) {
      case 'generate_password': {
        const length = Math.min(32, Math.max(8, args.length || 12));
        return { ok: true, result: generatePassword(length) };
      }
      case 'text_to_emoji':
        return { ok: true, result: textToEmoji(String(args.text || '')) };
      case 'magic_8ball': {
        const answer = eightBallResponses[Math.floor(Math.random() * eightBallResponses.length)];
        return { ok: true, result: { question: args.question, answer } };
      }
      case 'mock_text':
        return { ok: true, result: mockText(String(args.text || '')) };
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
      case 'flip_coin':
        return { ok: true, result: flipCoin() };
      case 'give_compliment': {
        const compliment = compliments[Math.floor(Math.random() * compliments.length)];
        const target = args.target ? String(args.target) : user.displayName || user.username;
        return { ok: true, result: `${target}, ${compliment}` };
      }
      case 'get_bot_stats': {
        const usageData = await getNavyUsage();
        let usageText = 'N/A';
        if (usageData?.plan && usageData?.usage && usageData?.limits) {
          const pct =
            typeof usageData.usage.percent_used === 'number'
              ? usageData.usage.percent_used.toFixed(1)
              : '0.0';
          usageText = `Plan: ${usageData.plan}, Tokens today: ${usageData.usage.tokens_used_today}/${usageData.limits.tokens_per_day} (${pct}%)`;
        }
        const sys = getSystemInfo();
        const diff = Date.now() - (startTime || Date.now());
        const seconds = Math.floor(diff / 1000);
        const uptime = `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`;
        return {
          ok: true,
          result: {
            model: botConfig.aiModel,
            usage: usageText,
            uptime,
            ping: client ? `${client.ws.ping}ms` : 'n/a',
            ram: sys.ram,
            os: sys.os,
            cpu: sys.cpu,
          },
        };
      }
      case 'clear_my_memory': {
        clearUserMemory(user.id);
        return { ok: true, result: 'Your persistent AI memory has been cleared.' };
      }
      case 'terminate_conversation': {
        if (!aiMessage?.id) return { ok: false, error: 'No active conversation message to terminate.' };
        const msgId = aiMessage.id;
        const thread = conversationThreads?.get(msgId);
        if (!thread) return { ok: false, error: 'Conversation already ended or not found.' };
        thread.replies = botConfig.maxReplies;
        conversationThreads.delete(msgId);
        const reason = args.reason ? String(args.reason).slice(0, 200) : 'Conversation ended by AI.';
        const endedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ai_reply_done').setLabel('Conversation Ended').setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId('ai_delete').setLabel('Delete').setStyle(ButtonStyle.Secondary)
        );
        try {
          const embeds = aiMessage.embeds;
          if (embeds?.[0]) {
            const newEmbed = EmbedBuilder.from(embeds[0]).setFooter({
              text: `Model: ${thread.model || botConfig.aiModel} • ENDED • ${reason}`,
            });
            await safeEditMessage(aiMessage, { embeds: [newEmbed], components: [endedRow] });
          } else {
            await safeEditMessage(aiMessage, { components: [endedRow] });
          }
        } catch {}
        return { ok: true, result: `Conversation terminated. Reason: ${reason}` };
      }
      case 'customize_embed': {
        const title = args.title || 'Default Title';
        const color = args.color || getGradualColor(conversationThreads?.get(aiMessage.id)?.replies || 0);
        if (!aiMessage) return { ok: false, error: 'No active conversation message to customize.' };
        try {
          const embeds = aiMessage.embeds;
          if (embeds?.[0]) {
            const newEmbed = EmbedBuilder.from(embeds[0])
              .setTitle(title)
              .setColor(color);
            await safeEditMessage(aiMessage, { embeds: [newEmbed] });
          } else {
            const newEmbed = new EmbedBuilder()
              .setTitle(title)
              .setColor(color);
            await safeEditMessage(aiMessage, { embeds: [newEmbed] });
          }
          return { ok: true, result: `Embed customized with title: ${title} and color: ${color}` };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
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
          },
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
          body: JSON.stringify(body),
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
          body: JSON.stringify({ password: onlineSecret, token: args.token }),
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

module.exports = {
  getToolsForUser,
  executeTool,
};
