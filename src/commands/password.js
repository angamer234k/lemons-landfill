const { SlashCommandBuilder } = require('discord.js');
const { generatePassword } = require('../helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('password')
    .setDescription('Generate a secure random password.')
    .addIntegerOption(opt =>
      opt.setName('length').setDescription('Length (8–32)').setMinValue(8).setMaxValue(32)
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const length = interaction.options.getInteger('length') || 12;
    const pwd = generatePassword(length);
    await interaction.reply({ content: `🔐 \`${pwd}\``, ephemeral: true });
  },
};
