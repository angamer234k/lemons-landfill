const { SlashCommandBuilder } = require('discord.js');
const { textToEmoji } = require('../helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('emoji')
    .setDescription('Convert text to regional indicator emojis.')
    .addStringOption(opt =>
      opt.setName('text').setDescription('Text').setRequired(true)
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const text = interaction.options.getString('text');
    const emojified = textToEmoji(text);
    await interaction.reply({ content: emojified || 'Could not convert that text.' });
  },
};
