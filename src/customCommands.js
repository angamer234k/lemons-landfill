const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const S = require('./customCommandStore');

function getCustomSlashJSON() {
  return S.getAllCommands().filter(c => c.enabled && !c.guildId).map(c => {
    const b = new SlashCommandBuilder().setName(c.name).setDescription(c.description || 'Custom flow command')
      .setIntegrationTypes([0, 1]).setContexts([0, 1, 2]);
    for (const opt of c.options || []) {
      const d = opt.description || opt.name;
      if (opt.type === 'string') b.addStringOption(o => o.setName(opt.name).setDescription(d).setRequired(!!opt.required));
      else if (opt.type === 'integer') b.addIntegerOption(o => o.setName(opt.name).setDescription(d).setRequired(!!opt.required));
      else if (opt.type === 'boolean') b.addBooleanOption(o => o.setName(opt.name).setDescription(d).setRequired(!!opt.required));
      else if (opt.type === 'user') b.addUserOption(o => o.setName(opt.name).setDescription(d).setRequired(!!opt.required));
      else if (opt.type === 'role') b.addRoleOption(o => o.setName(opt.name).setDescription(d).setRequired(!!opt.required));
      else if (opt.type === 'channel') b.addChannelOption(o => o.setName(opt.name).setDescription(d).setRequired(!!opt.required));
    }
    return b.toJSON();
  });
}
function interp(str, ctx) {
  if (!str) return '';
  return String(str)
    .replace(/\{\{user\.mention\}\}/gi, '<@' + ctx.user.id + '>')
    .replace(/\{\{user\.id\}\}/gi, ctx.user.id)
    .replace(/\{\{user\.tag\}\}/gi, ctx.user.tag || ctx.user.username)
    .replace(/\{\{user\}\}/gi, ctx.user.username)
    .replace(/\{\{channel\.id\}\}/gi, ctx.channel?.id || '')
    .replace(/\{\{channel\}\}/gi, ctx.channel?.name || ctx.channel?.id || '')
    .replace(/\{\{guild\.id\}\}/gi, ctx.guild?.id || '')
    .replace(/\{\{guild\}\}/gi, ctx.guild?.name || '')
    .replace(/\{\{option:([a-z0-9_]+)\}\}/gi, (_, name) => {
      const v = ctx.options[name];
      if (v == null) return '';
      if (typeof v === 'object' && v.id) return v.id;
      return String(v);
    });
}
function buildEmbed(embed, ctx) {
  if (!embed) return null;
  const e = new EmbedBuilder().setColor(embed.color || 0xfdff94);
  if (embed.title) e.setTitle(interp(embed.title, ctx));
  if (embed.description) e.setDescription(interp(embed.description, ctx));
  if (embed.footer) e.setFooter({ text: interp(embed.footer, ctx) });
  return e;
}
function collectOptions(interaction) {
  const out = {};
  if (!interaction.options) return out;
  for (const opt of interaction.options.data || []) {
    if (opt.user) out[opt.name] = opt.user;
    else if (opt.role) out[opt.name] = opt.role;
    else if (opt.channel) out[opt.name] = opt.channel;
    else out[opt.name] = opt.value;
  }
  return out;
}
async function resolveMember(interaction, action, options) {
  if (action.target === 'option' && action.optionName && options[action.optionName]) {
    const u = options[action.optionName];
    if (interaction.guild) return interaction.guild.members.fetch(u.id || u).catch(() => null);
  }
  return interaction.member || null;
}
async function executeCustom(interaction, cmd) {
  const { OWNER_ID } = require('./config');
  const options = collectOptions(interaction);
  const ctx = { user: interaction.user, member: interaction.member, channel: interaction.channel, guild: interaction.guild, options };
  let replied = false, replyMessage = null, i = 0;
  const actions = cmd.actions || [];
  while (i < actions.length) {
    const action = actions[i];
    if (action.type === 'condition') {
      let ok = false;
      if (action.when === 'is_owner') ok = interaction.user.id === OWNER_ID;
      else if (action.when === 'has_role' || action.when === 'missing_role') {
        const has = interaction.member?.roles?.cache?.has(action.roleId);
        ok = action.when === 'has_role' ? !!has : !has;
      } else if (action.when === 'option_equals') {
        const v = options[action.optionName];
        ok = String(v?.id || v || '') === String(action.equals || '');
      }
      if (!ok) { i += 1 + (action.skipOnFail || 1); continue; }
      i += 1; continue;
    }
    if (action.type === 'wait') { await new Promise(r => setTimeout(r, action.ms || 0)); i += 1; continue; }
    if (action.type === 'reply') {
      const content = interp(action.content, ctx) || undefined;
      const embed = buildEmbed(action.embed, ctx);
      const payload = { content: content || (embed ? undefined : '…'), embeds: embed ? [embed] : undefined, ephemeral: !!action.ephemeral };
      if (!replied) { await interaction.reply(payload); replied = true; try { replyMessage = await interaction.fetchReply(); } catch {} }
      else await interaction.followUp(payload);
      i += 1; continue;
    }
    if (action.type === 'edit_reply') {
      const content = interp(action.content, ctx);
      const embed = buildEmbed(action.embed, ctx);
      if (!replied) {
        await interaction.reply({ content: content || (embed ? undefined : '…'), embeds: embed ? [embed] : undefined, ephemeral: !!action.ephemeral });
        replied = true;
      } else await interaction.editReply({ content: content || null, embeds: embed ? [embed] : [] });
      i += 1; continue;
    }
    if (action.type === 'dm') {
      let targetUser = interaction.user;
      if (action.target === 'option' && action.optionName && options[action.optionName]) {
        const u = options[action.optionName];
        targetUser = u.username ? u : await interaction.client.users.fetch(u.id || u).catch(() => null);
      }
      if (targetUser) {
        const content = interp(action.content, ctx) || undefined;
        const embed = buildEmbed(action.embed, ctx);
        await targetUser.send({ content, embeds: embed ? [embed] : undefined }).catch(() => {});
      }
      i += 1; continue;
    }
    if (action.type === 'send_channel') {
      if (action.channelId) {
        const ch = await interaction.client.channels.fetch(action.channelId).catch(() => null);
        if (ch && ch.isTextBased()) {
          const content = interp(action.content, ctx) || undefined;
          const embed = buildEmbed(action.embed, ctx);
          await ch.send({ content, embeds: embed ? [embed] : undefined }).catch(() => {});
        }
      }
      i += 1; continue;
    }
    if (action.type === 'add_role' || action.type === 'remove_role') {
      const member = await resolveMember(interaction, action, options);
      if (member && action.roleId) {
        try {
          if (action.type === 'add_role') await member.roles.add(action.roleId);
          else await member.roles.remove(action.roleId);
        } catch {}
      }
      i += 1; continue;
    }
    if (action.type === 'react') {
      if (!replied) {
        await interaction.reply({ content: '🍋' }); replied = true;
        try { replyMessage = await interaction.fetchReply(); } catch {}
      }
      if (replyMessage && action.emoji) await replyMessage.react(action.emoji).catch(() => {});
      i += 1; continue;
    }
    i += 1;
  }
  if (!replied) await interaction.reply({ content: '✅ Flow finished (no reply action).', ephemeral: true });
}

module.exports = {
  loadStore: S.loadStore,
  saveStore: S.saveStore,
  getAllCommands: S.getAllCommands,
  getCommandByName: S.getCommandByName,
  addCommand: S.addCommand,
  updateCommand: S.updateCommand,
  deleteCommand: S.deleteCommand,
  isCommandDisabled: S.isCommandDisabled,
  setGuildDisabled: S.setGuildDisabled,
  setRoleDisabled: S.setRoleDisabled,
  getDisabled: S.getDisabled,
  getCustomSlashJSON,
  executeCustom,
  sanitizeName: S.sanitizeName,
};
