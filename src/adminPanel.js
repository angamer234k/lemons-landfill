const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { OWNER_ID } = require('./config');
const customCommands = require('./customCommands');
const botPresence = require('./botPresence');

const ADMIN_CHANNEL_ID = process.env.ADMIN_CHANNEL_ID || '1537831681812209764';

function isAdminUser(userId) {
  return userId === OWNER_ID;
}

async function sendAdminPanel(channel) {
  const embed = new EmbedBuilder()
    .setTitle('🍋 lemonAI Admin Panel')
    .setDescription(
      'Owner tools for this server.\n' +
        'Use the buttons below to open sub-menus.'
    )
    .setColor(0xfdff94)
    .addFields(
      { name: 'Moderation', value: 'Quick mute / kick helpers', inline: true },
      { name: 'Commands', value: 'Toggle commands · custom command builder', inline: true },
      { name: 'Status', value: 'Change bot presence / activity text', inline: true }
    )
    .setFooter({ text: 'Only the bot owner can use these controls' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin:mod').setLabel('Moderation').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin:cmds').setLabel('Commands').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin:status').setLabel('Bot status').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('admin:refresh').setLabel('Refresh panel').setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

function mainPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('admin:mod').setLabel('Moderation').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('admin:cmds').setLabel('Commands').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('admin:status').setLabel('Bot status').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('admin:refresh').setLabel('Refresh panel').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function mainPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('🍋 lemonAI Admin Panel')
    .setDescription('Owner tools for this server.\nUse the buttons below to open sub-menus.')
    .setColor(0xfdff94)
    .addFields(
      { name: 'Moderation', value: 'Kick / timeout helpers', inline: true },
      { name: 'Commands', value: 'Enable/disable commands · custom builder', inline: true },
      { name: 'Status', value: 'Presence & custom status text', inline: true }
    )
    .setTimestamp();
}

async function handleAdminButton(interaction, ctx) {
  if (!isAdminUser(interaction.user.id)) {
    await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
    return true;
  }

  const id = interaction.customId;

  if (id === 'admin:refresh' || id === 'admin:back') {
    await interaction.update({ embeds: [mainPanelEmbed()], components: mainPanelComponents() });
    return true;
  }

  if (id === 'admin:mod') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('admin:mod:timeout').setLabel('Timeout user…').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('admin:mod:kick').setLabel('Kick user…').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('admin:back').setLabel('← Back').setStyle(ButtonStyle.Secondary)
    );
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle('🛡️ Moderation')
          .setDescription('Pick an action. You will get a modal to enter the user ID and reason.')
          .setColor(0xed4245),
      ],
      components: [row],
    });
    return true;
  }

  if (id === 'admin:mod:timeout' || id === 'admin:mod:kick') {
    const isKick = id.endsWith('kick');
    const modal = new ModalBuilder()
      .setCustomId(isKick ? 'admin:modal:kick' : 'admin:modal:timeout')
      .setTitle(isKick ? 'Kick user' : 'Timeout user');
    const rows = [
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('userId').setLabel('User ID').setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(400)
      ),
    ];
    if (!isKick) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('minutes').setLabel('Minutes (1–10080)').setStyle(TextInputStyle.Short).setRequired(true).setValue('10')
        )
      );
    }
    modal.addComponents(...rows);
    await interaction.showModal(modal);
    return true;
  }

  if (id === 'admin:cmds') {
    const guildId = interaction.guildId;
    const disabled = customCommands.getDisabled(guildId);
    const allNames = [...(ctx.commands || new Map()).keys(), ...customCommands.getAllCommands().map(c => c.name)];
    const unique = [...new Set(allNames)].sort();

    const select = new StringSelectMenuBuilder()
      .setCustomId('admin:cmds:toggle')
      .setPlaceholder('Toggle server-wide disabled commands')
      .setMinValues(0)
      .setMaxValues(Math.min(25, unique.length || 1));

    for (const n of unique.slice(0, 25)) {
      select.addOptions({
        label: `/${n}`,
        value: n,
        description: disabled.guild.includes(n) ? 'Currently DISABLED' : 'Enabled',
        default: disabled.guild.includes(n),
      });
    }

    const rows = [];
    if (unique.length) rows.push(new ActionRowBuilder().addComponents(select));
    const dashUrl = process.env.PUBLIC_DASHBOARD_URL
      ? `${process.env.PUBLIC_DASHBOARD_URL.replace(/\/$/, '')}/cc`
      : 'http://localhost:15612/cc';
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin:cmds:cc').setLabel('Open custom command builder').setStyle(ButtonStyle.Link).setURL(dashUrl),
        new ButtonBuilder().setCustomId('admin:back').setLabel('← Back').setStyle(ButtonStyle.Secondary)
      )
    );

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle('⚙️ Commands')
          .setDescription(
            'Select commands to **disable for the whole server**.\n' +
              'Use the custom command builder web UI to create responses.\n\n' +
              `Currently disabled: ${disabled.guild.length ? disabled.guild.map(n => `\`${n}\``).join(', ') : '_none_'}`
          )
          .setColor(0x5865f2),
      ],
      components: rows,
    });
    return true;
  }

  if (id === 'admin:status') {
    const p = botPresence.getPresence();
    const modal = new ModalBuilder().setCustomId('admin:modal:status').setTitle('Bot presence / status');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('status').setLabel('Status (online / idle / dnd / invisible)').setStyle(TextInputStyle.Short).setRequired(true).setValue(p.status)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('activityType').setLabel('Type (playing/listening/watching/competing/custom)').setStyle(TextInputStyle.Short).setRequired(true).setValue(p.activityType)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('activityName').setLabel('Status / activity text').setStyle(TextInputStyle.Short).setRequired(false).setValue(p.activityName || '').setMaxLength(128)
      )
    );
    await interaction.showModal(modal);
    return true;
  }

  return false;
}

async function handleAdminSelect(interaction, ctx) {
  if (!isAdminUser(interaction.user.id)) {
    await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
    return true;
  }
  if (interaction.customId === 'admin:cmds:toggle') {
    const selected = interaction.values || [];
    customCommands.setGuildDisabled(interaction.guildId, selected);
    await interaction.reply({
      content: `✅ Server-disabled commands updated: ${selected.length ? selected.map(s => `\`${s}\``).join(', ') : '_none_'}`,
      ephemeral: true,
    });
    return true;
  }
  return false;
}

async function handleAdminModal(interaction, ctx) {
  if (!isAdminUser(interaction.user.id)) {
    await interaction.reply({ content: '❌ Owner only.', ephemeral: true });
    return true;
  }

  if (interaction.customId === 'admin:modal:status') {
    const status = interaction.fields.getTextInputValue('status').trim().toLowerCase();
    const activityType = interaction.fields.getTextInputValue('activityType').trim().toLowerCase();
    const activityName = interaction.fields.getTextInputValue('activityName') || '';
    try {
      botPresence.setPresenceConfig({ status, activityType, activityName });
      await botPresence.applyPresence(ctx.client);
      const p = botPresence.getPresence();
      await interaction.reply({
        content: `✅ Presence updated → **${p.status}** · ${p.activityType}: \`${p.activityName || '(none)'}\``,
        ephemeral: true,
      });
    } catch (e) {
      await interaction.reply({ content: `❌ ${e.message}`, ephemeral: true });
    }
    return true;
  }

  if (interaction.customId === 'admin:modal:kick' || interaction.customId === 'admin:modal:timeout') {
    const userId = interaction.fields.getTextInputValue('userId').trim();
    const reason = (interaction.fields.getTextInputValue('reason') || 'No reason provided').slice(0, 400);
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ Guild only.', ephemeral: true });
      return true;
    }
    try {
      const member = await guild.members.fetch(userId);
      if (interaction.customId === 'admin:modal:kick') {
        await member.kick(reason);
        await interaction.reply({ content: `✅ Kicked <@${userId}> — ${reason}`, ephemeral: true });
      } else {
        const minutes = Math.min(10080, Math.max(1, parseInt(interaction.fields.getTextInputValue('minutes'), 10) || 10));
        await member.timeout(minutes * 60 * 1000, reason);
        await interaction.reply({ content: `✅ Timed out <@${userId}> for ${minutes}m — ${reason}`, ephemeral: true });
      }
    } catch (e) {
      await interaction.reply({ content: `❌ Failed: ${e.message}`, ephemeral: true });
    }
    return true;
  }

  return false;
}

module.exports = {
  ADMIN_CHANNEL_ID,
  isAdminUser,
  sendAdminPanel,
  handleAdminButton,
  handleAdminSelect,
  handleAdminModal,
};
