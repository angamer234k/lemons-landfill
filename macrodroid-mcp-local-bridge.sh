#!/bin/sh

PORT="${PORT:-8787}"
MACRODROID_URL="${MACRODROID_URL:-https://trigger.macrodroid.com/dc1b6dca-6474-4990-8ff7-c620026bb4c6/mcp}"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g; s//\\r/g; s/$/\\n/' | tr -d '\n' | sed 's/\\n$//'
}

field_string() {
  printf '%s' "$1" | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1
}

request_id() {
  id=$(printf '%s' "$1" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*\([^,}]*\).*/\1/p' | head -n 1)
  [ -n "$id" ] && printf '%s' "$id" || printf 'null'
}

response() {
  body="$1"
  len=$(printf '%s' "$body" | wc -c)
  printf 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %s\r\nConnection: close\r\n\r\n%s' "$len" "$body"
}

trigger_macrodroid() {
  payload="$1"
  tmp="/tmp/macrodroid-mcp-payload.$$"
  printf '%s' "$payload" > "$tmp"
  wget -qO- --header='Content-Type: application/json' --post-file="$tmp" "$MACRODROID_URL" >/dev/null 2>&1
  rm -f "$tmp"
}

handle_body() {
  body="$1"
  id=$(request_id "$body")
  method=$(field_string "$body" method)

  case "$method" in
    initialize)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"macrodroid-local-bridge","version":"0.1.0"}}}' "$id"
      ;;
    notifications/initialized)
      printf ''
      ;;
    tools/list)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"ping_phone","description":"Check that the MacroDroid bridge is reachable.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}},{"name":"show_toast","description":"Trigger MacroDroid to show a toast message.","inputSchema":{"type":"object","properties":{"message":{"type":"string"}},"required":["message"],"additionalProperties":false}},{"name":"run_macro","description":"Trigger MacroDroid to run a named macro branch.","inputSchema":{"type":"object","properties":{"name":{"type":"string"},"params":{"type":"object"}},"required":["name"],"additionalProperties":false}}]}}' "$id"
      ;;
    tools/call)
      tool=$(field_string "$body" name)
      if [ "$tool" = "ping_phone" ]; then
        printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"pong from local MacroDroid bridge"}],"structuredContent":{"ok":true}}}' "$id"
      elif [ "$tool" = "show_toast" ]; then
        msg=$(field_string "$body" message)
        esc=$(json_escape "$msg")
        trigger_macrodroid "{\"action_type\":\"toast\",\"action_message\":\"$esc\"}"
        printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"Triggered MacroDroid toast"}],"structuredContent":{"ok":true,"action_type":"toast","action_message":"%s"}}}' "$id" "$esc"
      elif [ "$tool" = "run_macro" ]; then
        macro=$(field_string "$body" name | tail -n 1)
        esc=$(json_escape "$macro")
        trigger_macrodroid "{\"action_type\":\"run_macro\",\"action_name\":\"$esc\"}"
        printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"Triggered MacroDroid macro"}],"structuredContent":{"ok":true,"action_type":"run_macro","action_name":"%s"}}}' "$id" "$esc"
      else
        esc=$(json_escape "$tool")
        printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32602,"message":"Unknown tool: %s"}}' "$id" "$esc"
      fi
      ;;
    *)
      esc=$(json_escape "$method")
      printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32601,"message":"Method not found: %s"}}' "$id" "$esc"
      ;;
  esac
}

while true; do
  req=$(nc -l -p "$PORT")
  body=$(printf '%s' "$req" | awk 'found { print; next } /^\r?$/ { found=1 }')
  [ -z "$body" ] && body=$(printf '%s' "$req" | tail -n 1)
  out=$(handle_body "$body")
  response "$out" | nc -l -p "$PORT"
done
