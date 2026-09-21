/**
 * MCP stdio <-> Xiaozhi WebSocket pipe (Node version of mcp_pipe.py)
 * Reads MCP_ENDPOINT from env and pipes mcp/server.js over stdio.
 */
import { spawn } from "node:child_process";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import WebSocket from "ws";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), ".env") });
// also try parent .env (main bot)
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const endpoint = process.env.MCP_ENDPOINT;

if (!endpoint || !endpoint.startsWith("ws")) {
  console.error("[mcp-pipe] Missing or invalid MCP_ENDPOINT in .env");
  process.exit(1);
}

const INITIAL_BACKOFF = 1000;
const MAX_BACKOFF = 60000;

function startServerProcess() {
  const serverPath = path.join(__dirname, "server.js");
  const child = spawn(process.execPath, [serverPath], {
    cwd: __dirname,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stderr.on("data", (buf) => {
    process.stderr.write(`[mcp-server] ${buf}`);
  });

  child.on("exit", (code, signal) => {
    console.error(`[mcp-pipe] server exited code=${code} signal=${signal}`);
  });

  return child;
}

async function connectOnce() {
  return new Promise((resolve, reject) => {
    console.error(`[mcp-pipe] connecting to ${endpoint.slice(0, 48)}...`);
    const ws = new WebSocket(endpoint);
    let child = null;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      try { ws.close(); } catch {}
      if (child && !child.killed) {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 3000);
      }
    };

    ws.on("open", () => {
      console.error("[mcp-pipe] WebSocket connected");
      child = startServerProcess();

      // WS -> server stdin
      ws.on("message", (data) => {
        if (!child?.stdin?.writable) return;
        const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        child.stdin.write(text.endsWith("\n") ? text : text + "\n");
      });

      // server stdout -> WS
      child.stdout.on("data", (buf) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(buf.toString("utf8"));
        }
      });

      child.on("exit", () => {
        cleanup();
        reject(new Error("MCP server process exited"));
      });
    });

    ws.on("close", (code, reason) => {
      console.error(`[mcp-pipe] WebSocket closed code=${code} reason=${reason}`);
      cleanup();
      reject(new Error(`WebSocket closed ${code}`));
    });

    ws.on("error", (err) => {
      console.error(`[mcp-pipe] WebSocket error: ${err.message}`);
      cleanup();
      reject(err);
    });

    process.on("SIGINT", () => {
      cleanup();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      cleanup();
      process.exit(0);
    });
  });
}

async function main() {
  let backoff = INITIAL_BACKOFF;
  while (true) {
    try {
      await connectOnce();
      backoff = INITIAL_BACKOFF;
    } catch (err) {
      console.error(`[mcp-pipe] reconnecting in ${backoff / 1000}s... (${err.message})`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
    }
  }
}

main();
