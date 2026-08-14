require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');

const { CHECK_INTERVAL_MS } = require('./src/config');
const { loadMemories } = require('./src/memory');
const { updateStatusEmbed, checkPresence } = require('./src/roblox');
const { fetchTextModels } = require('./src/ai');
const { initReminders } = require('./src/reminders');
const { startHttpServer } = require('./src/httpServer');
const customCommands = require('./src/customCommands');
const botPresence = require('./src/botPresence');
const { ADMIN_CHANNEL_ID, sendAdminPanel, handleAdminButton, handleAdminSelect, handleAdminModal } = require('./src/adminPanel');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
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

// ---------- LOAD COMMANDS ----------
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

  // Prefer built-in names if collision
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

// ---------- INTERACTIONS ----------
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

      // Custom command fallback
      const custom = customCommands.getCommandByName(name, guildId);
      if (custom) {
        await customCommands.executeCustom(interaction, custom);
        return;
      }

      await interaction.reply({ content: 'Unknown command.', ephemeral: true }).catch(() => {});
      return;
    }

    if (interaction.isButton()) {
      // Admin panel buttons
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

// ---------- STARTUP ----------
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

  // Post / refresh admin panel in configured channel if accessible
  if (ADMIN_CHANNEL_ID && ADMIN_CHANNEL_ID.length >= 16) {
    try {
      const ch = await client.channels.fetch(ADMIN_CHANNEL_ID);
      if (ch && ch.isTextBased()) {
        // avoid spam: only send if no recent panel from us
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

// Same port as before — nudge + status API + dashboard + /cc
startHttpServer(ctx);

client.login(process.env.DISCORD_TOKEN);
