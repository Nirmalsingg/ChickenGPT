const http = require("http");
const fs = require("fs");
const path = require("path");

loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = path.join(__dirname, "public");
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const ALLOWED_MODELS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "gemma2-9b-it"
]);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 30);
const rateLimitBuckets = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendStreamEvent(res, event, payload) {
  res.write(`data: ${JSON.stringify({ event, ...payload })}\n\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function safeJoin(base, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0]);
  const target = path.normalize(path.join(base, decoded === "/" ? "index.html" : decoded));
  return target.startsWith(base) ? target : null;
}

function getClientId(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function checkRateLimit(req) {
  const now = Date.now();
  const clientId = getClientId(req);
  const bucket = rateLimitBuckets.get(clientId) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  bucket.count += 1;
  rateLimitBuckets.set(clientId, bucket);

  if (rateLimitBuckets.size > 1000) {
    for (const [key, value] of rateLimitBuckets.entries()) {
      if (value.resetAt <= now) rateLimitBuckets.delete(key);
    }
  }

  return {
    ok: bucket.count <= RATE_LIMIT_MAX_REQUESTS,
    retryAfter: Math.ceil((bucket.resetAt - now) / 1000)
  };
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function validateChatPayload(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const settings = body.settings && typeof body.settings === "object" ? body.settings : {};
  const model = ALLOWED_MODELS.has(settings.model) ? settings.model : DEFAULT_MODEL;

  const cleanMessages = [];
  for (const message of messages.slice(-40)) {
    if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
    const content = String(message.content || "").slice(0, 60_000).trim();
    if (!content) continue;
    cleanMessages.push({ role: message.role, content });
  }

  const systemPrompt = String(settings.systemPrompt || "").slice(0, 12_000).trim();
  const groqMessages = systemPrompt ? [{ role: "system", content: systemPrompt }] : [];
  groqMessages.push(...cleanMessages);

  return {
    messages: cleanMessages,
    groqMessages,
    settings: {
      model,
      temperature: clampNumber(settings.temperature, 0.7, 0, 2),
      maxTokens: Math.round(clampNumber(settings.maxTokens, 1200, 128, 8192))
    }
  };
}

async function handleChat(req, res) {
  const limit = checkRateLimit(req);
  if (!limit.ok) {
    sendJson(res, 429, { error: `Too many requests. Try again in ${limit.retryAfter} seconds.` });
    return;
  }

  try {
    const body = JSON.parse(await readBody(req) || "{}");
    const { messages, groqMessages, settings } = validateChatPayload(body);

    if (!messages.some((message) => message.role === "user")) {
      sendJson(res, 400, { error: "Send at least one user message." });
      return;
    }

    if (!GROQ_API_KEY) {
      sendJson(res, 500, { error: "GROQ_API_KEY is not set on the server." });
      return;
    }

    const wantsStream = body.stream !== false;
    if (wantsStream) {
      await streamGroqResponse(req, res, groqMessages, settings);
      return;
    }

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: settings.model,
        messages: groqMessages,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      sendJson(res, response.status, {
        error: payload.error?.message || `Groq request failed with status ${response.status}.`
      });
      return;
    }

    sendJson(res, 200, {
      mode: "live",
      text: payload.choices?.[0]?.message?.content || "Groq returned an empty response.",
      model: payload.model || settings.model,
      usage: payload.usage || null
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error." });
  }
}

async function streamGroqResponse(req, res, messages, settings) {
  const controller = new AbortController();
  res.on("close", () => controller.abort());

  const groqResponse = await fetch(GROQ_API_URL, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      stream: true
    })
  });

  res.writeHead(groqResponse.ok ? 200 : groqResponse.status, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "Connection": "keep-alive"
  });

  if (!groqResponse.ok || !groqResponse.body) {
    const payload = await groqResponse.json().catch(() => ({}));
    sendStreamEvent(res, "error", {
      error: payload.error?.message || `Groq request failed with status ${groqResponse.status}.`
    });
    res.end();
    return;
  }

  sendStreamEvent(res, "meta", { model: settings.model });

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for await (const chunk of groqResponse.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        const payload = JSON.parse(data);
        const token = payload.choices?.[0]?.delta?.content;
        if (token) sendStreamEvent(res, "token", { token });
      }
    }

    sendStreamEvent(res, "done", { model: settings.model });
    res.end();
  } catch (error) {
    if (!res.writableEnded) {
      sendStreamEvent(res, "error", {
        error: error.name === "AbortError" ? "Generation stopped." : "Streaming failed."
      });
      res.end();
    }
  }
}

function serveStatic(req, res) {
  const target = safeJoin(PUBLIC_DIR, req.url || "/");
  if (!target) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(target, (error, data) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallbackData) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
        res.end(fallbackData);
      });
      return;
    }

    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    sendJson(res, 200, { ok: true, service: "ChickenGPT" });
    return;
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    handleChat(req, res);
    return;
  }
  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }
  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`ChickenGPT is running at http://localhost:${PORT}`);
  console.log(`Groq mode enabled with default model ${DEFAULT_MODEL}.`);
});
