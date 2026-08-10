const { SlashCommandBuilder } = require('discord.js');
const { compliments } = require('../helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compliment')
    .setDescription('Send a wholesome compliment.')
    .addUserOption(opt =>
      opt.setName('user').setDescription('Who to compliment')
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const compliment = compliments[Math.floor(Math.random() * compliments.length)];
    await interaction.reply({ content: `${target}, ${compliment} 💖` });
  },
};
