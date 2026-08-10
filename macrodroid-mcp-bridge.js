var SERVER_NAME = "macrodroid-diy-mcp";
var SERVER_VERSION = "0.2.0";

var tools = [
  {
    name: "ping_phone",
    description: "Check that the MacroDroid MCP bridge is reachable.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "show_toast",
    description: "Show a toast message on the phone.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Text to show." }
      },
      required: ["message"],
      additionalProperties: false
    }
  },
  {
    name: "speak_text",
    description: "Speak text aloud using MacroDroid text-to-speech.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to speak." }
      },
      required: ["text"],
      additionalProperties: false
    }
  },
  {
    name: "send_notification",
    description: "Post a notification on the phone.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Notification title." },
        text: { type: "string", description: "Notification body." }
      },
      required: ["title", "text"],
      additionalProperties: false
    }
  },
  {
    name: "vibrate",
    description: "Vibrate the phone for a short duration.",
    inputSchema: {
      type: "object",
      properties: {
        milliseconds: { type: "number", description: "Duration in milliseconds." }
      },
      additionalProperties: false
    }
  },
  {
    name: "open_url",
    description: "Ask MacroDroid to open a URL on the phone.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open." }
      },
      required: ["url"],
      additionalProperties: false
    }
  },
  {
    name: "copy_to_clipboard",
    description: "Copy text to the Android clipboard.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to copy." }
      },
      required: ["text"],
      additionalProperties: false
    }
  },
  {
    name: "flashlight",
    description: "Turn the flashlight on, off, or toggle it.",
    inputSchema: {
      type: "object",
      properties: {
        state: {
          type: "string",
          enum: ["on", "off", "toggle"],
          description: "Desired flashlight state."
        }
      },
      required: ["state"],
      additionalProperties: false
    }
  },
  {
    name: "set_volume",
    description: "Set a phone volume stream through MacroDroid.",
    inputSchema: {
      type: "object",
      properties: {
        stream: {
          type: "string",
          enum: ["media", "ring", "alarm", "notification", "system"],
          description: "Volume stream."
        },
        level: { type: "number", description: "Volume level or percentage, depending on your MacroDroid action." }
      },
      required: ["stream", "level"],
      additionalProperties: false
    }
  },
  {
    name: "run_macro",
    description: "Ask MacroDroid to run a named macro/action branch.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Macro/action name." },
        params: { type: "object", description: "Optional parameters." }
      },
      required: ["name"],
      additionalProperties: false
    }
  }
];

function jsonRpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id: id,
    result: result
  };
}

function jsonRpcError(id, code, message, data) {
  var error = {
    code: code,
    message: message
  };

  if (data !== undefined) {
    error.data = data;
  }

  return {
    jsonrpc: "2.0",
    id: id === undefined ? null : id,
    error: error
  };
}

function textContent(text) {
  return [
    {
      type: "text",
      text: String(text)
    }
  ];
}

function toolResult(text, macroDroidAction) {
  var result = {
    content: textContent(text)
  };

  if (macroDroidAction) {
    result.structuredContent = {
      ok: true,
      macroDroidAction: macroDroidAction
    };
  }

  return result;
}

function requireString(args, name) {
  if (!args || typeof args[name] !== "string" || args[name].length === 0) {
    throw new Error("Missing required string argument: " + name);
  }

  return args[name];
}

function optionalNumber(args, name, fallback) {
  if (!args || args[name] === undefined || args[name] === null || args[name] === "") {
    return fallback;
  }

  var value = Number(args[name]);

  if (!isFinite(value)) {
    throw new Error("Invalid number argument: " + name);
  }

  return value;
}

function requireEnum(args, name, allowed) {
  var value = requireString(args, name);

  for (var i = 0; i < allowed.length; i++) {
    if (value === allowed[i]) {
      return value;
    }
  }

  throw new Error("Invalid " + name + ": " + value);
}

function callTool(name, args) {
  if (name === "ping_phone") {
    return toolResult("pong from MacroDroid", {
      type: "none",
      server: SERVER_NAME,
      time: new Date().toISOString()
    });
  }

  if (name === "show_toast") {
    var message = requireString(args, "message");

    return toolResult("Toast requested: " + message, {
      type: "toast",
      message: message
    });
  }

  if (name === "speak_text") {
    var speakText = requireString(args, "text");

    return toolResult("Speech requested: " + speakText, {
      type: "speak_text",
      text: speakText
    });
  }

  if (name === "send_notification") {
    var title = requireString(args, "title");
    var notificationText = requireString(args, "text");

    return toolResult("Notification requested: " + title, {
      type: "notification",
      title: title,
      text: notificationText
    });
  }

  if (name === "vibrate") {
    var milliseconds = optionalNumber(args, "milliseconds", 500);

    if (milliseconds < 1) {
      milliseconds = 1;
    }

    if (milliseconds > 10000) {
      milliseconds = 10000;
    }

    return toolResult("Vibration requested: " + milliseconds + "ms", {
      type: "vibrate",
      milliseconds: milliseconds
    });
  }

  if (name === "open_url") {
    var url = requireString(args, "url");

    if (url.indexOf("http://") !== 0 && url.indexOf("https://") !== 0) {
      throw new Error("URL must start with http:// or https://");
    }

    return toolResult("Open URL requested: " + url, {
      type: "open_url",
      url: url
    });
  }

  if (name === "copy_to_clipboard") {
    var clipboardText = requireString(args, "text");

    return toolResult("Clipboard copy requested", {
      type: "clipboard",
      text: clipboardText
    });
  }

  if (name === "flashlight") {
    var state = requireEnum(args, "state", ["on", "off", "toggle"]);

    return toolResult("Flashlight requested: " + state, {
      type: "flashlight",
      state: state
    });
  }

  if (name === "set_volume") {
    var stream = requireEnum(args, "stream", ["media", "ring", "alarm", "notification", "system"]);
    var level = optionalNumber(args, "level", 50);

    if (level < 0) {
      level = 0;
    }

    if (level > 100) {
      level = 100;
    }

    return toolResult("Volume requested: " + stream + " = " + level, {
      type: "set_volume",
      stream: stream,
      level: level
    });
  }

  if (name === "run_macro") {
    var macroName = requireString(args, "name");
    var params = args && args.params && typeof args.params === "object" ? args.params : {};

    return toolResult("Macro requested: " + macroName, {
      type: "run_macro",
      name: macroName,
      params: params
    });
  }

  throw new Error("Unknown tool: " + name);
}

function handleRequest(request) {
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return jsonRpcError(null, -32600, "Invalid Request");
  }

  if (request.method === "initialize") {
    return jsonRpcResult(request.id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION
      }
    });
  }

  if (request.method === "notifications/initialized") {
    return null;
  }

  if (request.method === "tools/list") {
    return jsonRpcResult(request.id, {
      tools: tools
    });
  }

  if (request.method === "tools/call") {
    try {
      var params = request.params || {};
      var toolName = requireString(params, "name");
      var args = params.arguments || {};
      return jsonRpcResult(request.id, callTool(toolName, args));
    } catch (error) {
      return jsonRpcError(request.id, -32602, error.message);
    }
  }

  return jsonRpcError(request.id, -32601, "Method not found: " + request.method);
}

function handleJsonRpc(inputText) {
  var parsed;

  try {
    parsed = JSON.parse(inputText);
  } catch (error) {
    return JSON.stringify(jsonRpcError(null, -32700, "Parse error", error.message));
  }

  if (Object.prototype.toString.call(parsed) === "[object Array]") {
    var batch = [];

    for (var i = 0; i < parsed.length; i++) {
      var response = handleRequest(parsed[i]);
      if (response !== null) {
        batch.push(response);
      }
    }

    return JSON.stringify(batch);
  }

  var singleResponse = handleRequest(parsed);
  return singleResponse === null ? "" : JSON.stringify(singleResponse);
}

var body = '{lv=rBody}';
var result = handleJsonRpc(body);
result;
