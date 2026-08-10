const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getWeather } = require('../utils/weather');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weather')
    .setDescription('Get current weather for a city.')
    .addStringOption(opt =>
      opt.setName('city').setDescription('City name').setRequired(true)
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const city = interaction.options.getString('city');
    await interaction.deferReply();

    try {
      const data = await getWeather(city);
      if (!data.ok) {
        await interaction.editReply(`❌ ${data.error}`);
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`🌤️ ${data.location}`)
        .setDescription(`**${data.condition}**`)
        .addFields(
          { name: 'Temperature', value: `${data.temperature_c}°C`, inline: true },
          { name: 'Feels like', value: `${data.feels_like_c}°C`, inline: true },
          { name: 'Humidity', value: `${data.humidity_pct}%`, inline: true },
          { name: 'Wind', value: `${data.wind_kmh} km/h`, inline: true }
        )
        .setColor(0x57A0F0)
        .setFooter({ text: `As of ${data.time}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Weather error:', err.message);
      await interaction.editReply(`❌ Failed to fetch weather: ${err.message}`);
    }
  },
};
