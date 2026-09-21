# lemons-mcp

Custom MCP server for **lemons-landfill** so Xiaozhi AI can control:

- reminders (add / list / cancel)
- wall moderation (approve / reject / reply)
- Roblox host presence check
- send Discord messages
- basic bot status

## Setup

```bash
cd mcp
cp .env.example .env
# edit .env — put DISCORD_TOKEN, ONLINE_SECRET, and MCP_ENDPOINT
npm install
```

You can also put `MCP_ENDPOINT` in the **root** `.env` of the bot (index.js reads it).

## Auto-start with the Discord bot

If `MCP_ENDPOINT` is set in the root `.env`, `index.js` will automatically spawn the MCP bridge when the bot starts. No extra commands needed.

## Manual run

```bash
# just the MCP server (stdio)
npm start

# full bridge to Xiaozhi (needs MCP_ENDPOINT)
npm run pipe
```

## Tools

| Tool | Description |
|------|-------------|
| `add_reminder` | Set a reminder (e.g. `10m`, `2h`) |
| `list_reminders` | List pending reminders |
| `cancel_reminder` | Cancel by ID |
| `wall_approve` | Approve wall post |
| `wall_reject` | Reject wall post |
| `wall_reply` | Reply on wall post |
| `roblox_status` | Check host online/offline |
| `send_discord_message` | Send message to a channel |
| `bot_status` | MCP + Discord status |
