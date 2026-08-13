const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('choose')
    .setDescription('Pick randomly from a list of options.')
    .addStringOption(opt =>
      opt
        .setName('options')
        .setDescription('Separate with commas or |  — e.g. pizza, sushi, tacos')
        .setRequired(true)
        .setMaxLength(500)
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const raw = interaction.options.getString('options', true);
    const parts = raw
      .split(/[,|]/)
      .map(s => s.trim())
      .filter(Boolean);

    if (parts.length < 2) {
      await interaction.reply({
        content: '❌ Need at least 2 options (separate with commas or `|`).',
        ephemeral: true,
      });
      return;
    }

    const pick = parts[Math.floor(Math.random() * parts.length)];

    const embed = new EmbedBuilder()
      .setTitle('✨ I choose…')
      .setColor(0xfdff94)
      .setDescription(`## ${pick}`)
      .addFields({
        name: 'Options',
        value: parts.map(p => `• ${p}`).join('\n').slice(0, 1000),
      })
      .setFooter({ text: `Asked by ${interaction.user.username}` });

    await interaction.reply({ embeds: [embed] });
  },
};
