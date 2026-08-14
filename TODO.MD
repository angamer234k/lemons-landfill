# Todo

[+] Make cool custom command builder (possibly at server's page /cc (custom command))
[+] Make admin panel for server channel <#130386002387118>
    |
     - sub todo: let it open sub menus for moderation, commands (custom command builder, turn off or on certain commands for certain roles or the whole server)
[+] Implement custom bot status (aka that speech bubble next to the bots PFP with like text in it)
[+] Change bot status to idle

## Notes
- Custom commands: open http://<host>:15612/cc (same NUDGE_SECRET as dashboard)
- After creating/editing global custom slash commands, click "Re-register slash cmds" on /cc
- Admin panel posts to ADMIN_CHANNEL_ID (env) or the channel id from the original TODO
- Presence defaults to idle + custom status text; editable from dashboard card or admin panel "Bot status"
- Server-wide command disable is in the Discord admin panel → Commands (role-level disable API exists in customCommands.js: setRoleDisabled)
