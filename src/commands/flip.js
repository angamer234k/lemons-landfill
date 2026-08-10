const { SlashCommandBuilder } = require('discord.js');
const { flipCoin } = require('../helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('flip')
    .setDescription('Flip a coin.')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const result = flipCoin();
    await interaction.reply({ content: `🪙 It's **${result}**!` });
  },
};
