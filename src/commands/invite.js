const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { OWNER_ID } = require('../config');

const SITE = (process.env.SITE_URL || 'https://xn--e1aleee.space').replace(/\/$/, '');
// punycode fallback; лемон.space also works from bot if DNS ok
const INVITE_API = `${SITE}/api/invite`;

const PRESETS = {
  basic: {
    label: 'basic',
    perks: {
      noSlowmode: true,
      maxChars: 2000,
      maxImageMB: 2.5,
      wallHighlight: true,
      canPublic: true,
      autoApproveWall: true,
      vipLounge: true,
    },
  },
  vip: {
    label: 'vip',
    perks: {
      noSlowmode: true,
      maxChars: 3000,
      maxImageMB: 3,
      wallHighlight: true,
      canPublic: true,
      autoApproveWall: true,
      vipLounge: true,
    },
  },
  god: {
    label: 'god',
    perks: {
      noSlowmode: true,
      maxChars: 5000,
      maxImageMB: 4,
      wallHighlight: true,
      canPublic: true,
      autoApproveWall: true,
      vipLounge: true,
    },
  },
};

const FLAG_KEYS = [
  'noSlowmode',
  'autoApproveWall',
  'wallHighlight',
  'vipLounge',
  'canPublic',
];

function secret() {
  return process.env.ONLINE_SECRET || process.env.WALL_MOD_SECRET || '';
}

function shortToken(t) {
  if (!t || t.length < 12) return t || '?';
  return t.slice(0, 8) + '…' + t.slice(-4);
}

function formatTtl(ttl) {
  if (ttl === -1 || ttl == null) return 'permanent';
  if (ttl < 0) return 'expired?';
  if (ttl < 60) return ttl + 's';
  if (ttl < 3600) return Math.round(ttl / 60) + 'm';
  if (ttl < 86400) return Math.round(ttl / 3600) + 'h';
  return Math.round(ttl / 86400) + 'd';
}

function perksLine(p) {
  if (!p) return '—';
  return [
    p.noSlowmode ? 'no-slow' : 'slow',
    `${p.maxChars || '?'}c`,
    `${p.maxImageMB || '?'}MB`,
    p.autoApproveWall ? 'auto-wall' : 'mod-wall',
    p.wallHighlight ? 'highlight' : null,
    p.vipLounge ? 'vip' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

async function api(method, body) {
  const s = secret();
  if (!s) throw new Error('ONLINE_SECRET not set on bot');
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  };
  if (method === 'GET') {
    const q = new URLSearchParams({ password: s });
    const r = await fetch(`${INVITE_API}?${q}`, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }
  opts.body = JSON.stringify({ password: s, ...body });
  const r = await fetch(INVITE_API, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function inviteEmbed(row) {
  const p = row.perks || {};
  return new EmbedBuilder()
    .setColor(0xfdff94)
    .setTitle(`🎫 invite ${row.label ? `· ${row.label}` : ''}`)
    .setDescription(
      `**token:** \`${row.token}\`\n` +
        `**ttl:** ${formatTtl(row.ttl)}\n` +
        `**perks:** ${perksLine(p)}\n` +
        `**message:** ${row.link || '—'}\n` +
        (row.vipLink ? `**vip:** ${row.vipLink}` : '')
    )
    .setFooter({ text: 'use buttons to edit · only you can use these' });
}

function editPanel(token) {
  const row1 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`invite:toggle:${token}`)
      .setPlaceholder('toggle a flag…')
      .addOptions(
        FLAG_KEYS.map((k) => ({
          label: k,
          value: k,
          description: `flip ${k}`,
        }))
      )
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`invite:limits:${token}`)
      .setLabel('limits')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`invite:label:${token}`)
      .setLabel('label')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`invite:expiry:${token}`)
      .setLabel('expiry')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`invite:refresh:${token}`)
      .setLabel('refresh')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`invite:revoke:${token}`)
      .setLabel('revoke')
      .setStyle(ButtonStyle.Danger)
  );
  return [row1, row2];
}

async function fetchOne(token) {
  const data = await api('GET');
  const row = (data.tokens || []).find((t) => t.token === token);
  if (!row) throw new Error('invite not found (revoked or expired)');
  return row;
}

function ownerOnly(interaction) {
  if (interaction.user.id !== OWNER_ID) {
    return false;
  }
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Manage лемон.space invites (owner only).')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2])
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new invite link.')
        .addStringOption((opt) =>
          opt
            .setName('preset')
            .setDescription('Perk preset')
            .addChoices(
              { name: 'basic (2k / 2.5MB)', value: 'basic' },
              { name: 'vip (3k / 3MB)', value: 'vip' },
              { name: 'god (5k / 4MB)', value: 'god' }
            )
        )
        .addIntegerOption((opt) =>
          opt
            .setName('expires_in')
            .setDescription('Expiration in seconds (empty = permanent)')
            .setMinValue(60)
            .setMaxValue(365 * 86400)
        )
        .addStringOption((opt) =>
          opt.setName('label').setDescription('Optional label (shows on form badge)').setMaxLength(32)
        )
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List active invites.'))
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Open the invite editor panel.')
        .addStringOption((opt) =>
          opt
            .setName('token')
            .setDescription('Invite token (autocomplete)')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('revoke')
        .setDescription('Revoke an invite.')
        .addStringOption((opt) =>
          opt
            .setName('token')
            .setDescription('Token to revoke')
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(interaction) {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.respond([]);
    }
    try {
      const data = await api('GET');
      const focused = (interaction.options.getFocused() || '').toLowerCase();
      const choices = (data.tokens || [])
        .filter(
          (t) =>
            t.token.toLowerCase().includes(focused) ||
            (t.label || '').toLowerCase().includes(focused)
        )
        .slice(0, 25)
        .map((t) => ({
          name: `${t.label ? t.label + ' · ' : ''}${shortToken(t.token)} · ${formatTtl(t.ttl)}`.slice(
            0,
            100
          ),
          value: t.token,
        }));
      await interaction.respond(choices.length ? choices : []);
    } catch {
      await interaction.respond([]).catch(() => {});
    }
  },

  async execute(interaction) {
    if (!ownerOnly(interaction)) {
      return interaction.reply({
        content: '❌ owner only.',
        ephemeral: true,
      });
    }
    if (!secret()) {
      return interaction.reply({
        content: '❌ `ONLINE_SECRET` not set on bot.',
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    try {
      if (sub === 'create') {
        const presetName = interaction.options.getString('preset') || 'basic';
        const preset = PRESETS[presetName] || PRESETS.basic;
        const expiresIn = interaction.options.getInteger('expires_in');
        const labelOpt = interaction.options.getString('label');
        const body = {
          perks: preset.perks,
          label: labelOpt || preset.label,
        };
        if (expiresIn) body.expiresIn = expiresIn;

        const data = await api('POST', body);
        await interaction.editReply({
          embeds: [
            inviteEmbed({
              token: data.token,
              label: data.label,
              perks: data.perks,
              ttl: data.expiresIn || -1,
              link: data.link,
              vipLink: data.vipLink,
            }),
          ],
          components: editPanel(data.token),
        });
        return;
      }

      if (sub === 'list') {
        const data = await api('GET');
        const tokens = data.tokens || [];
        if (!tokens.length) {
          await interaction.editReply('no active invites.');
          return;
        }
        const lines = tokens
          .slice(0, 15)
          .map(
            (t) =>
              `• **${t.label || 'invite'}** \`${shortToken(t.token)}\` · ${formatTtl(t.ttl)}\n  ${perksLine(t.perks)}\n  ${t.link}`
          )
          .join('\n\n');
        await interaction.editReply({
          content: `📋 **${tokens.length} active invite(s)**\n\n${lines}`,
        });
        return;
      }

      if (sub === 'edit') {
        const token = interaction.options.getString('token');
        const row = await fetchOne(token);
        await interaction.editReply({
          embeds: [inviteEmbed(row)],
          components: editPanel(token),
        });
        return;
      }

      if (sub === 'revoke') {
        const token = interaction.options.getString('token');
        await api('DELETE', { token });
        await interaction.editReply(`✅ revoked \`${token}\``);
      }
    } catch (err) {
      await interaction.editReply(`❌ ${err.message}`);
    }
  },

  async handleButton(interaction) {
    if (!interaction.customId?.startsWith('invite:')) return false;
    if (!ownerOnly(interaction)) {
      await interaction.reply({ content: 'owner only', ephemeral: true }).catch(() => {});
      return true;
    }

    const parts = interaction.customId.split(':');
    // invite:action:token (token may contain colons? uuid has none with our format - has hyphens)
    const action = parts[1];
    const token = parts.slice(2).join(':');

    try {
      if (action === 'refresh') {
        await interaction.deferUpdate();
        const row = await fetchOne(token);
        await interaction.editReply({
          embeds: [inviteEmbed(row)],
          components: editPanel(token),
        });
        return true;
      }

      if (action === 'revoke') {
        await interaction.deferUpdate();
        await api('DELETE', { token });
        await interaction.editReply({
          content: `✅ revoked \`${token}\``,
          embeds: [],
          components: [],
        });
        return true;
      }

      if (action === 'limits') {
        const row = await fetchOne(token);
        const modal = new ModalBuilder()
          .setCustomId(`invite:modal-limits:${token}`)
          .setTitle('Edit limits')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('maxChars')
                .setLabel('Max chars (100–5000)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(String(row.perks?.maxChars || 2000))
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('maxImageMB')
                .setLabel('Max image MB (0.5–5)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue(String(row.perks?.maxImageMB || 2.5))
            )
          );
        await interaction.showModal(modal);
        return true;
      }

      if (action === 'label') {
        const row = await fetchOne(token);
        const modal = new ModalBuilder()
          .setCustomId(`invite:modal-label:${token}`)
          .setTitle('Edit label')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('label')
                .setLabel('Label (empty to clear)')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(32)
                .setValue(row.label || '')
            )
          );
        await interaction.showModal(modal);
        return true;
      }

      if (action === 'expiry') {
        const modal = new ModalBuilder()
          .setCustomId(`invite:modal-expiry:${token}`)
          .setTitle('Edit expiry')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('expiresIn')
                .setLabel('Seconds from now (−1 = permanent)')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('86400 or -1')
            )
          );
        await interaction.showModal(modal);
        return true;
      }
    } catch (err) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: `❌ ${err.message}`, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true }).catch(() => {});
      }
    }
    return true;
  },

  async handleSelect(interaction) {
    if (!interaction.customId?.startsWith('invite:toggle:')) return false;
    if (!ownerOnly(interaction)) {
      await interaction.reply({ content: 'owner only', ephemeral: true }).catch(() => {});
      return true;
    }

    const token = interaction.customId.slice('invite:toggle:'.length);
    const key = interaction.values[0];

    try {
      await interaction.deferUpdate();
      const row = await fetchOne(token);
      const perks = { ...(row.perks || {}) };
      if (!FLAG_KEYS.includes(key)) throw new Error('unknown flag');
      perks[key] = !perks[key];
      const updated = await api('PATCH', { token, perks });
      await interaction.editReply({
        embeds: [inviteEmbed({ ...updated, ttl: updated.ttl })],
        components: editPanel(token),
      });
    } catch (err) {
      await interaction.followUp({ content: `❌ ${err.message}`, ephemeral: true }).catch(() => {});
    }
    return true;
  },

  async handleModal(interaction) {
    if (!interaction.customId?.startsWith('invite:modal-')) return false;
    if (!ownerOnly(interaction)) {
      await interaction.reply({ content: 'owner only', ephemeral: true }).catch(() => {});
      return true;
    }

    // invite:modal-limits:token
    const rest = interaction.customId.slice('invite:modal-'.length);
    const colon = rest.indexOf(':');
    const kind = rest.slice(0, colon);
    const token = rest.slice(colon + 1);

    try {
      await interaction.deferUpdate();

      if (kind === 'limits') {
        const maxChars = Number(interaction.fields.getTextInputValue('maxChars'));
        const maxImageMB = Number(interaction.fields.getTextInputValue('maxImageMB'));
        const updated = await api('PATCH', {
          token,
          perks: { maxChars, maxImageMB },
        });
        await interaction.editReply({
          embeds: [inviteEmbed(updated)],
          components: editPanel(token),
        });
        return true;
      }

      if (kind === 'label') {
        const label = interaction.fields.getTextInputValue('label');
        const updated = await api('PATCH', { token, label });
        await interaction.editReply({
          embeds: [inviteEmbed(updated)],
          components: editPanel(token),
        });
        return true;
      }

      if (kind === 'expiry') {
        const expiresIn = Number(interaction.fields.getTextInputValue('expiresIn'));
        const updated = await api('PATCH', { token, expiresIn });
        await interaction.editReply({
          embeds: [inviteEmbed(updated)],
          components: editPanel(token),
        });
        return true;
      }
    } catch (err) {
      await interaction.followUp({ content: `❌ ${err.message}`, ephemeral: true }).catch(() => {});
    }
    return true;
  },
};
