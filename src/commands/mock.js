const { SlashCommandBuilder } = require('discord.js');
const { mockText } = require('../helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mock')
    .setDescription('Convert text to mocking case.')
    .addStringOption(opt =>
      opt.setName('text').setDescription('Text').setRequired(true)
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const text = interaction.options.getString('text');
    await interaction.reply({ content: mockText(text) });
  },
};
