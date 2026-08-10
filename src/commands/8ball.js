const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { eightBallResponses } = require('../helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the Magic 8-Ball a question.')
    .addStringOption(opt =>
      opt.setName('question').setDescription('Your question').setRequired(true)
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const question = interaction.options.getString('question');
    const answer = eightBallResponses[Math.floor(Math.random() * eightBallResponses.length)];
    const embed = new EmbedBuilder()
      .setTitle('🎱 Magic 8-Ball')
      .addFields(
        { name: 'Question', value: question },
        { name: 'Answer', value: answer }
      )
      .setColor(0x9B59B6)
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
};
