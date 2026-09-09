require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  REST,
  Routes,
  ChannelType,
} = require('discord.js');

const { CHECK_INTERVAL_MS, OWNER_ID } = require('./src/config');
const { loadMemories } = require('./src/memory');
const { updateStatusEmbed, checkPresence } = require('./src/roblox');
const { fetchTextModels } = require('./src/ai');
const { initReminders } = require('./src/reminders');
const { startHttpServer, getWallReactionMap, callWallMod } = require('./src/httpServer');
const { callSiteWallMod } = require('./src/siteWall');
const customCommands = require('./src/customCommands');
const botPresence = require('./src/botPresence');
const { ADMIN_CHANNEL_ID, sendAdminPanel, handleAdminButton, handleAdminSelect, handleAdminModal } = require('./src/adminPanel');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const commands = new Collection();
const conversationThreads = new Map();
const startTime = Date.now();

const ctx = {
  client,
  conversationThreads,
  startTime,
  commands,
  customCommands,
  botPresence,
};

const commandsPath = path.join(__dirname, 'src', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command?.data?.name) {
    commands.set(command.data.name, command);
    console.log(`Loaded command: /${command.data.name}`);
  } else {
    console.warn(`Skipping invalid command file: ${file}`);
  }
}

const aiCommand = commands.get('ai');

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const builtIn = [...commands.values()].map(c => c.data.toJSON());
  const custom = customCommands.getCustomSlashJSON();

  const builtInNames = new Set(builtIn.map(c => c.name));
  const customFiltered = custom.filter(c => !builtInNames.has(c.name));
  const body = [...builtIn, ...customFiltered];

  try {
    console.log(`Registering ${body.length} slash commands (${builtIn.length} built-in + ${customFiltered.length} custom)...`);
    await rest.put(Routes.applicationCommands(client.user.id), { body });
    console.log('Slash commands registered.');
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
}

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isAutocomplete()) {
      const command = commands.get(interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(interaction, ctx);
      return;
    }

    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;
      const guildId = interaction.guildId || null;
      const memberRoles = interaction.member?.roles?.cache
        ? [...interaction.member.roles.cache.keys()]
        : [];

      if (customCommands.isCommandDisabled(guildId, name, memberRoles)) {
        await interaction.reply({
          content: '❌ This command is disabled for you or this server.',
          ephemeral: true,
        }).catch(() => {});
        return;
      }

      const command = commands.get(name);
      if (command) {
        await command.execute(interaction, ctx);
        return;
      }

      const custom = customCommands.getCommandByName(name, guildId);
      if (custom) {
        await customCommands.executeCustom(interaction, custom);
        return;
      }

      await interaction.reply({ content: 'Unknown command.', ephemeral: true }).catch(() => {});
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId?.startsWith('admin:')) {
        const handled = await handleAdminButton(interaction, ctx);
        if (handled) return;
      }
      if (aiCommand?.handleButton) {
        const handled = await aiCommand.handleButton(interaction, ctx);
        if (handled) return;
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId?.startsWith('admin:')) {
        const handled = await handleAdminModal(interaction, ctx);
        if (handled) return;
      }
      if (aiCommand?.handleModal) {
        const handled = await aiCommand.handleModal(interaction, ctx);
        if (handled) return;
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId?.startsWith('admin:')) {
        const handled = await handleAdminSelect(interaction, ctx);
        if (handled) return;
      }
      return;
    }
  } catch (error) {
    console.error('Unhandled interaction error:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true }).catch(() => {});
    } else if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content: `❌ Error: ${error.message}` }).catch(() => {});
    }
  }
});

// Wall mod via reactions on site DMs
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.bot) return;
    if (user.id !== OWNER_ID) return;

    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }

    const map = getWallReactionMap();
    const entry = map.get(reaction.message.id);
    if (!entry || entry.status !== 'pending') return;

    const emoji = reaction.emoji.name;
    if (emoji !== '✅' && emoji !== '❌') return;

    const action = emoji === '✅' ? 'approve' : 'reject';
    try {
      await callWallMod(action, entry.wallId);
      entry.status = action === 'approve' ? 'live' : 'rejected';
      map.set(reaction.message.id, entry);
      const note = action === 'approve' ? '🟢 wall approved' : '🚫 wall rejected';
      await reaction.message.reply({ content: note }).catch(() => {});
    } catch (err) {
      console.error('wall mod via reaction failed:', err.message);
      await reaction.message.reply({ content: `mod failed: ${err.message}` }).catch(() => {});
    }
  } catch (err) {
    console.error('messageReactionAdd error:', err);
  }
});

// Reply in Discord DM to a site message → show on wall
client.on('messageCreate', async (msg) => {
  try {
    if (msg.author.bot) return;
    if (msg.author.id !== OWNER_ID) return;
    if (!msg.reference?.messageId) return;

    // DMs only
    const isDm =
      msg.channel.type === ChannelType.DM ||
      msg.channel.type === 1 ||
      msg.channel.isDMBased?.();
    if (!isDm) return;

    const map = getWallReactionMap();
    let entry = map.get(msg.reference.messageId);

    // Fallback: pull id from referenced embed footer (id:xxx) if map was lost after restart
    if (!entry) {
      try {
        const ref = await msg.channel.messages.fetch(msg.reference.messageId);
        const footer = ref.embeds?.[0]?.footer?.text || '';
        const m = footer.match(/id:([a-z0-9-]+)/i);
        if (m) {
          entry = { wallId: m[1], status: 'unknown', public: true };
          map.set(ref.id, entry);
        }
      } catch {
        return;
      }
    }
    if (!entry?.wallId) return;

    const text = (msg.content || '').trim();
    if (!text) {
      await msg.reply('empty reply ignored').catch(() => {});
      return;
    }

    try {
      await callSiteWallMod({ action: 'reply', id: entry.wallId, text: text.slice(0, 1000) });
      await msg.react('🍋').catch(() => {});
      await msg.reply('posted to wall under that message 🍋').catch(() => {});
    } catch (err) {
      console.error('wall reply failed:', err.message);
      await msg.reply(`could not post reply: ${err.message}`).catch(() => {});
    }
  } catch (err) {
    console.error('messageCreate wall-reply error:', err);
  }
});

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  loadMemories();
  initReminders(client);
  await registerCommands();
  await botPresence.applyPresence(client);
  console.log('Bot presence applied:', botPresence.getPresence());

  await updateStatusEmbed(client, false);
  await checkPresence(client);
  setInterval(() => checkPresence(client), CHECK_INTERVAL_MS);
  fetchTextModels()
    .then(m => console.log(`Cached ${m.length} text models.`))
    .catch(() => {});

  if (ADMIN_CHANNEL_ID && ADMIN_CHANNEL_ID.length >= 16) {
    try {
      const ch = await client.channels.fetch(ADMIN_CHANNEL_ID);
      if (ch && ch.isTextBased()) {
        const recent = await ch.messages.fetch({ limit: 15 }).catch(() => null);
        const hasPanel = recent?.some(
          m => m.author.id === client.user.id && m.embeds[0]?.title?.includes('Admin Panel')
        );
        if (!hasPanel) await sendAdminPanel(ch);
      }
    } catch (err) {
      console.warn('Admin channel not available:', err.message);
    }
  }
});

startHttpServer(ctx);

client.login(process.env.DISCORD_TOKEN);
