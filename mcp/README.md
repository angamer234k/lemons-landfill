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
# edit .env and put your real DISCORD_TOKEN + ONLINE_SECRET
npm install
```

## Run (stdio – for Xiaozhi / mcp_pipe)

```bash
npm start
```

## Xiaozhi config example

```json
{
  "mcpEndpoint": "wss://api.xiaozhi.me/mcp/?token=YOUR_TOKEN",
  "mcpServers": {
    "lemons-landfill": {
      "command": "node",
      "args": ["/absolute/path/to/lemons-landfill/mcp/server.js"],
      "env": {
        "DISCORD_TOKEN": "your_token",
        "ONLINE_SECRET": "your_secret",
        "OWNER_ID": "1131451961942749206"
      }
    }
  }
}
```

Or with xiaozhi-client:

```bash
xiaozhi config set mcpEndpoint "wss://..."
# then add the server block above into xiaozhi.config.json
xiaozhi start
```
