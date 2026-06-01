const http = require("http");
const fs = require("fs");
const path = require("path");

loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = path.join(__dirname, "public");
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

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

async function handleChat(req, res) {
  try {
    const body = JSON.parse(await readBody(req) || "{}");
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const settings = body.settings || {};

    if (!messages.some((message) => message.role === "user")) {
      sendJson(res, 400, { error: "Send at least one user message." });
      return;
    }

    if (!GROQ_API_KEY) {
      sendJson(res, 500, { error: "GROQ_API_KEY is not set on the server." });
      return;
    }

    const groqMessages = [];
    if (settings.systemPrompt) {
      groqMessages.push({ role: "system", content: String(settings.systemPrompt) });
    }
    for (const message of messages) {
      if (message.role !== "user" && message.role !== "assistant") continue;
      groqMessages.push({
        role: message.role,
        content: String(message.content || "")
      });
    }

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: groqMessages,
        temperature: Number(settings.temperature ?? 0.7),
        max_tokens: Number(settings.maxTokens ?? 1200)
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
      model: payload.model || GROQ_MODEL,
      usage: payload.usage || null
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error." });
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
  console.log(`Groq mode enabled with model ${GROQ_MODEL}.`);
});
