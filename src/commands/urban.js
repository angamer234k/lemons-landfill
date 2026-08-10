const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { urbanLookup } = require('../helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('urban')
    .setDescription('Look up a term on Urban Dictionary.')
    .addStringOption(opt =>
      opt.setName('term').setDescription('Term').setRequired(true)
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const term = interaction.options.getString('term');
    await interaction.deferReply();
    const result = await urbanLookup(term);
    if (!result) {
      await interaction.editReply(`❌ No definition found for **${term}**.`);
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle(`📖 ${term}`)
      .setURL(result.permalink)
      .setDescription(result.definition)
      .addFields({ name: 'Example', value: result.example })
      .setFooter({ text: `Author: ${result.author}` })
      .setColor(0x1D3557);
    await interaction.editReply({ embeds: [embed] });
  },
};
