const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  isValidTimeZone,
  setUserTimezone,
  getUserTimezone,
  clearUserTimezone,
  getAllTimezones,
  formatInZone,
  COMMON_ZONES,
} = require('../timezones');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timezone')
    .setDescription('Set your timezone or check local times.')
    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Set your IANA timezone')
        .addStringOption(opt =>
          opt
            .setName('zone')
            .setDescription('e.g. Europe/Moscow, America/New_York')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('me').setDescription('Show your local time')
    )
    .addSubcommand(sub =>
      sub
        .setName('user')
        .setDescription("Show another user's local time")
        .addUserOption(opt =>
          opt.setName('target').setDescription('Who').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('board').setDescription('Show local times for everyone who set a zone')
    )
    .addSubcommand(sub =>
      sub.setName('clear').setDescription('Remove your saved timezone')
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const matches = COMMON_ZONES.filter(z => z.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(matches.map(z => ({ name: z, value: z })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const now = new Date();

    if (sub === 'set') {
      const zone = interaction.options.getString('zone', true).trim();
      if (!isValidTimeZone(zone)) {
        await interaction.reply({
          content:
            '❌ Invalid timezone. Use an IANA name like `Europe/Moscow` or `America/New_York`.',
          ephemeral: true,
        });
        return;
      }
      setUserTimezone(interaction.user.id, zone);
      await interaction.reply({
        content: `🌍 Timezone set to **${zone}**\nLocal time: **${formatInZone(now, zone)}**`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'clear') {
      const ok = clearUserTimezone(interaction.user.id);
      await interaction.reply({
        content: ok ? '🗑️ Your timezone was cleared.' : 'You had no timezone saved.',
        ephemeral: true,
      });
      return;
    }

    if (sub === 'me') {
      const zone = getUserTimezone(interaction.user.id);
      if (!zone) {
        await interaction.reply({
          content: 'No timezone set. Use `/timezone set zone:Europe/Moscow` first.',
          ephemeral: true,
        });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle(`🕒 ${interaction.user.username}`)
        .setColor(0x5865f2)
        .setDescription(`**${formatInZone(now, zone)}**\n\`${zone}\``);
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'user') {
      const target = interaction.options.getUser('target', true);
      const zone = getUserTimezone(target.id);
      if (!zone) {
        await interaction.reply({
          content: `**${target.username}** hasn’t set a timezone yet.`,
          ephemeral: true,
        });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle(`🕒 ${target.username}`)
        .setColor(0x5865f2)
        .setDescription(`**${formatInZone(now, zone)}**\n\`${zone}\``)
        .setThumbnail(target.displayAvatarURL({ size: 128 }));
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'board') {
      const all = [...getAllTimezones().entries()];
      if (all.length === 0) {
        await interaction.reply({
          content: 'Nobody has set a timezone yet. Be the first with `/timezone set`.',
          ephemeral: true,
        });
        return;
      }

      // Sort by current UTC offset approx via formatted hour
      all.sort((a, b) => a[1].localeCompare(b[1]));

      const lines = [];
      for (const [userId, zone] of all.slice(0, 25)) {
        let name = userId;
        try {
          const u = await interaction.client.users.fetch(userId);
          name = u.username;
        } catch {
          // keep id
        }
        lines.push(`**${name}** — ${formatInZone(now, zone)} \`(${zone})\``);
      }

      const embed = new EmbedBuilder()
        .setTitle('🌍 Timezone board')
        .setColor(0xfdff94)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `${all.length} saved · now` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  },
};
