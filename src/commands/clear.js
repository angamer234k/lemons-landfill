const { SlashCommandBuilder } = require('discord.js');
const { clearUserMemory } = require('../memory');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear your AI conversation memory.')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    clearUserMemory(interaction.user.id);
    await interaction.reply({
      content: '🧹 Your AI conversation memory has been cleared.',
      ephemeral: true,
    });
  },
};
