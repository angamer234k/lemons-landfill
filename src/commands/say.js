const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Make the bot say something (restricted).')
    .addStringOption(opt =>
      opt.setName('message').setDescription('What to say').setRequired(true)
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const message = interaction.options.getString('message');
    await interaction.reply({ content: message });
  },
};
