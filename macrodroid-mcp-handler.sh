#!/bin/sh

MACRODROID_URL="${MACRODROID_URL:-https://trigger.macrodroid.com/dc1b6dca-6474-4990-8ff7-c620026bb4c6/mcp}"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g; s///g; s/
/\\n/g'
}

read_request_body() {
  content_length=0

  while IFS= read -r line; do
    line=$(printf '%s' "$line" | tr -d '\r')
    [ -z "$line" ] && break
    case "$line" in
      Content-Length:*|content-length:*)
        content_length=$(printf '%s' "$line" | sed 's/[^0-9]//g')
        ;;
    esac
  done

  if [ "$content_length" -gt 0 ] 2>/dev/null; then
    dd bs=1 count="$content_length" 2>/dev/null
  fi
}

request_id() {
  id=$(printf '%s' "$1" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*\([^,}]*\).*/\1/p' | head -n 1)
  [ -n "$id" ] && printf '%s' "$id" || printf 'null'
}

method_name() {
  printf '%s' "$1" | sed -n 's/.*"method"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

tool_name() {
  printf '%s' "$1" | sed -n 's/.*"params"[[:space:]]*:[[:space:]]*{[[:space:]]*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

arg_string() {
  printf '%s' "$1" | sed -n "s/.*\"arguments\"[[:space:]]*:[[:space:]]*{.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1
}

http_response() {
  body="$1"
  len=$(printf '%s' "$body" | wc -c | tr -d ' ')
  printf 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %s\r\nConnection: close\r\n\r\n%s' "$len" "$body"
}

trigger_macrodroid() {
  payload="$1"
  tmp="/tmp/macrodroid-mcp-payload.$$"
  printf '%s' "$payload" > "$tmp"
  wget -qO- --header='Content-Type: application/json' --post-file="$tmp" "$MACRODROID_URL" >/dev/null 2>&1
  rm -f "$tmp"
}

body=$(read_request_body)
id=$(request_id "$body")
method=$(method_name "$body")

case "$method" in
  initialize)
    out=$(printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"macrodroid-local-bridge","version":"0.1.0"}}}' "$id")
    ;;
  notifications/initialized)
    out=''
    ;;
  tools/list)
    out=$(printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"ping_phone","description":"Check that the local MacroDroid bridge is reachable.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}},{"name":"show_toast","description":"Trigger MacroDroid with a toast request.","inputSchema":{"type":"object","properties":{"message":{"type":"string"}},"required":["message"],"additionalProperties":false}},{"name":"run_macro","description":"Trigger MacroDroid with a named macro request.","inputSchema":{"type":"object","properties":{"name":{"type":"string"},"params":{"type":"object"}},"required":["name"],"additionalProperties":false}}]}}' "$id")
    ;;
  tools/call)
    tool=$(tool_name "$body")
    case "$tool" in
      ping_phone)
        out=$(printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"pong from local MacroDroid bridge"}],"structuredContent":{"ok":true}}}' "$id")
        ;;
      show_toast)
        msg=$(arg_string "$body" message)
        esc=$(json_escape "$msg")
        trigger_macrodroid "{\"action_type\":\"toast\",\"action_message\":\"$esc\"}"
        out=$(printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"Triggered MacroDroid toast"}],"structuredContent":{"ok":true,"action_type":"toast","action_message":"%s"}}}' "$id" "$esc")
        ;;
      run_macro)
        macro=$(arg_string "$body" name)
        esc=$(json_escape "$macro")
        trigger_macrodroid "{\"action_type\":\"run_macro\",\"action_name\":\"$esc\"}"
        out=$(printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"Triggered MacroDroid macro"}],"structuredContent":{"ok":true,"action_type":"run_macro","action_name":"%s"}}}' "$id" "$esc")
        ;;
      *)
        esc=$(json_escape "$tool")
        out=$(printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32602,"message":"Unknown tool: %s"}}' "$id" "$esc")
        ;;
    esac
    ;;
  *)
    esc=$(json_escape "$method")
    out=$(printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32601,"message":"Method not found: %s"}}' "$id" "$esc")
    ;;
esac

http_response "$out"
