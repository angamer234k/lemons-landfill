const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('qr')
    .setDescription('Generate a QR code from text or a URL.')
    .addStringOption(opt =>
      opt
        .setName('data')
        .setDescription('Text or URL to encode')
        .setRequired(true)
        .setMaxLength(800)
    )
    .addIntegerOption(opt =>
      opt
        .setName('size')
        .setDescription('Image size in pixels (default 300)')
        .setMinValue(100)
        .setMaxValue(1000)
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const data = interaction.options.getString('data', true).trim();
    const size = interaction.options.getInteger('size') || 300;

    const url =
      'https://api.qrserver.com/v1/create-qr-code/?' +
      new URLSearchParams({
        size: `${size}x${size}`,
        data,
        margin: '8',
      }).toString();

    const embed = new EmbedBuilder()
      .setTitle('📱 QR code')
      .setColor(0xfdff94)
      .setDescription(`\`${data.length > 200 ? data.slice(0, 197) + '...' : data}\``)
      .setImage(url)
      .setFooter({ text: `${size}×${size}` });

    await interaction.reply({ embeds: [embed] });
  },
};
