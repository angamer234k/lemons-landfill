require('dotenv').config();
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');

const { OWNER_ID, NUDGE_SECRET, CHECK_INTERVAL_MS } = require('./src/config');
const { loadMemories } = require('./src/memory');
const { updateStatusEmbed, checkPresence } = require('./src/roblox');
const { fetchTextModels } = require('./src/ai');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const commands = new Collection();
const conversationThreads = new Map();
const startTime = Date.now();

const ctx = {
  client,
  conversationThreads,
  startTime,
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
  const body = [...commands.values()].map(c => c.data.toJSON());
  try {
    console.log(`Registering ${body.length} slash commands...`);
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
      const command = commands.get(interaction.commandName);
      if (!command) {
        await interaction.reply({ content: 'Unknown command.', ephemeral: true }).catch(() => {});
        return;
      }
      await command.execute(interaction, ctx);
      return;
    }

    if (interaction.isButton()) {
      if (aiCommand?.handleButton) {
        const handled = await aiCommand.handleButton(interaction, ctx);
        if (handled) return;
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      if (aiCommand?.handleModal) {
        const handled = await aiCommand.handleModal(interaction, ctx);
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
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  loadMemories();
  await registerCommands();
  await updateStatusEmbed(client, false);
  await checkPresence(client);
  setInterval(() => checkPresence(client), CHECK_INTERVAL_MS);
  fetchTextModels()
    .then(m => console.log(`Cached ${m.length} text models.`))
    .catch(() => {});
});

// ---------- NUDGE ENDPOINT ----------
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/nudge') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
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

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('Nudge error:', err);
        res.writeHead(500);
        res.end('error');
      }
    });
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(15612, () => {
  console.log('Nudge server listening on :15612');
});

client.login(process.env.DISCORD_TOKEN);
