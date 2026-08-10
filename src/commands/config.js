const { SlashCommandBuilder } = require('discord.js');
const { OWNER_ID, botConfig, PROVIDER_DEFAULTS } = require('../config');
const { fetchTextModels, formatModelChoice } = require('../ai');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure bot settings (Owner only).')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2])
    .addSubcommandGroup(group =>
      group
        .setName('ai')
        .setDescription('AI Settings')
        .addSubcommand(sub =>
          sub
            .setName('max_replies')
            .setDescription('Set max replies per AI conversation')
            .addIntegerOption(opt =>
              opt.setName('limit').setDescription('Max replies').setRequired(true).setMinValue(1).setMaxValue(50)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('allow_others')
            .setDescription('Allow other users to reply in AI threads')
            .addBooleanOption(opt =>
              opt.setName('allow').setDescription('True/False').setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('terminate')
            .setDescription('Terminate an active AI conversation')
            .addStringOption(opt =>
              opt.setName('message_id').setDescription('Message ID of the embed').setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('model')
            .setDescription('Set the default AI model (text models only)')
            .addStringOption(opt =>
              opt.setName('name').setDescription('Model ID (use autocomplete)').setRequired(true).setAutocomplete(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('provider')
            .setDescription('Switch AI provider (navy or mistral)')
            .addStringOption(opt =>
              opt
                .setName('name')
                .setDescription('Provider')
                .setRequired(true)
                .addChoices(
                  { name: 'Navy', value: 'navy' },
                  { name: 'Mistral', value: 'mistral' }
                )
            )
        )
    )
    .addSubcommand(sub => sub.setName('view').setDescription('View current configuration')),

  async autocomplete(interaction) {
    if (interaction.options.getSubcommand() !== 'model') return;
    const focused = interaction.options.getFocused().toLowerCase();
    const models = await fetchTextModels();
    const filtered = models
      .filter(m => m.id.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(formatModelChoice);
    await interaction.respond(
      filtered.length ? filtered : [{ name: 'No matching models', value: 'gpt-3.5-turbo' }]
    );
  },

  async execute(interaction, ctx) {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: '❌ Only the bot owner can use this command.',
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);

    if (sub === 'view') {
      return interaction.reply({
        content:
          `**⚙️ Current Configuration:**\n` +
          `- **Provider:** \`${botConfig.provider}\`\n` +
          `- **AI Model:** \`${botConfig.aiModel}\`\n` +
          `- **Max AI Replies:** ${botConfig.maxReplies}\n` +
          `- **Allow Others to Reply:** ${botConfig.allowOthersToReply ? 'Yes' : 'No'}`,
        ephemeral: true,
      });
    }

    if (group === 'ai') {
      if (sub === 'max_replies') {
        botConfig.maxReplies = interaction.options.getInteger('limit');
        return interaction.reply({
          content: `✅ AI max replies per conversation set to **${botConfig.maxReplies}**.`,
          ephemeral: true,
        });
      }
      if (sub === 'allow_others') {
        botConfig.allowOthersToReply = interaction.options.getBoolean('allow');
        return interaction.reply({
          content: `✅ AI allow others to reply set to **${botConfig.allowOthersToReply ? 'True' : 'False'}**.`,
          ephemeral: true,
        });
      }
      if (sub === 'terminate') {
        const msgId = interaction.options.getString('message_id');
        if (ctx.conversationThreads.has(msgId)) {
          ctx.conversationThreads.delete(msgId);
          return interaction.reply({
            content: `✅ AI Conversation thread \`${msgId}\` has been abruptly terminated.`,
            ephemeral: true,
          });
        }
        return interaction.reply({
          content: `❌ No active conversation found with ID \`${msgId}\`.`,
          ephemeral: true,
        });
      }
      if (sub === 'model') {
        const modelName = interaction.options.getString('name');
        const models = await fetchTextModels();
        const found = models.find(m => m.id === modelName);
        if (!found) {
          return interaction.reply({
            content: `❌ \`${modelName}\` is not a valid text model. Use autocomplete to pick one.`,
            ephemeral: true,
          });
        }
        botConfig.aiModel = modelName;
        const mult = found.multiplier === 0 ? 'free' : `×${found.multiplier}`;
        const prem = found.premium ? ' (premium)' : '';
        return interaction.reply({
          content: `✅ Default AI model set to **\`${botConfig.aiModel}\`** (${mult})${prem}.`,
          ephemeral: true,
        });
      }
      if (sub === 'provider') {
        const name = interaction.options.getString('name');
        if (name !== 'navy' && name !== 'mistral') {
          return interaction.reply({
            content: '❌ Provider must be `navy` or `mistral`.',
            ephemeral: true,
          });
        }
        if (name === 'mistral' && !process.env.MISTRAL_API_KEY) {
          return interaction.reply({
            content: '❌ `MISTRAL_API_KEY` is not set in the .env file.',
            ephemeral: true,
          });
        }
        if (name === 'navy' && !process.env.NAVY_API_KEY) {
          return interaction.reply({
            content: '❌ `NAVY_API_KEY` is not set in the .env file.',
            ephemeral: true,
          });
        }
        botConfig.provider = name;
        botConfig.aiModel = PROVIDER_DEFAULTS[name].model;
        return interaction.reply({
          content:
            `✅ AI provider set to **\`${name}\`**.\n` +
            `Default model switched to \`${botConfig.aiModel}\`.\n` +
            `Use \`/config ai model\` to pick another.`,
          ephemeral: true,
        });
      }
    }
  },
};
