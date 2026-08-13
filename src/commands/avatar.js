const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription("Show a user's avatar.")
    .addUserOption(opt =>
      opt.setName('user').setDescription('Whose avatar? (default: you)')
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const url = user.displayAvatarURL({ size: 1024, extension: 'png' });

    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s avatar`)
      .setImage(url)
      .setColor(0x5865f2)
      .setDescription(`[Open original](${user.displayAvatarURL({ size: 4096 })})`);

    await interaction.reply({ embeds: [embed] });
  },
};
