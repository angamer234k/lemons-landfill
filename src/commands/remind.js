const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  parseDuration,
  formatDuration,
  addReminder,
  getUserReminders,
  cancelReminder,
} = require('../reminders');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Set, list, or cancel personal reminders.')
    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Set a reminder')
        .addStringOption(opt =>
          opt
            .setName('time')
            .setDescription('When (e.g. 10m, 2h, 1d, 1h30m)')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('message')
            .setDescription('What to remind you about')
            .setRequired(true)
            .setMaxLength(500)
        )
    )
    .addSubcommand(sub =>
      sub.setName('list').setDescription('List your pending reminders')
    )
    .addSubcommand(sub =>
      sub
        .setName('cancel')
        .setDescription('Cancel a reminder by ID')
        .addStringOption(opt =>
          opt.setName('id').setDescription('Reminder ID from /remind list').setRequired(true)
        )
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const timeStr = interaction.options.getString('time', true);
      const message = interaction.options.getString('message', true);
      const durationMs = parseDuration(timeStr);

      if (!durationMs) {
        await interaction.reply({
          content:
            '❌ Couldn’t parse that time. Try formats like `10m`, `2h`, `1d`, or `1h30m`.',
          ephemeral: true,
        });
        return;
      }

      try {
        const reminder = addReminder({
          userId: interaction.user.id,
          channelId: interaction.channelId,
          message,
          durationMs,
        });

        const embed = new EmbedBuilder()
          .setTitle('⏰ Reminder set')
          .setColor(0x57f287)
          .setDescription(
            `I’ll remind you in **${formatDuration(durationMs)}**:\n> ${message}`
          )
          .addFields({
            name: 'ID',
            value: `\`${reminder.id}\``,
            inline: true,
          })
          .setFooter({ text: 'Delivered via DM (or this channel if DMs are closed)' });

        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (err) {
        await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      }
      return;
    }

    if (sub === 'list') {
      const list = getUserReminders(interaction.user.id);
      if (list.length === 0) {
        await interaction.reply({
          content: '📭 You have no pending reminders.',
          ephemeral: true,
        });
        return;
      }

      const lines = list.map(r => {
        const left = formatDuration(r.dueAt - Date.now());
        return `• \`${r.id}\` — in **${left}**\n  > ${r.message}`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`⏰ Your reminders (${list.length})`)
        .setColor(0x5865f2)
        .setDescription(lines.join('\n\n'))
        .setFooter({ text: 'Cancel with /remind cancel id:<id>' });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === 'cancel') {
      const id = interaction.options.getString('id', true).trim();
      const ok = cancelReminder(id, interaction.user.id);
      if (!ok) {
        await interaction.reply({
          content: '❌ Reminder not found (or it’s not yours).',
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({
        content: `🗑️ Cancelled reminder \`${id}\`.`,
        ephemeral: true,
      });
    }
  },
};
