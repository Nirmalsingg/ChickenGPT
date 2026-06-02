# ChickenGPT

ChickenGPT is a modern vanilla web AI chatbot with a Node.js backend proxy for Groq. It keeps the Groq API key on the server, streams assistant responses to the browser, and stores conversations locally in the user's browser.

## Features

- Responsive ChatGPT-style workspace with dark and light themes
- Streaming Groq responses with typing indicator and stop generation
- Markdown rendering for headings, lists, tables, bold, italic, inline code, and code blocks
- Syntax highlighting through Highlight.js
- Local chat history with multiple conversations
- Create, rename, delete, share, and export conversations
- Export formats: TXT, Markdown, and JSON
- Message actions: copy, edit user message, regenerate response, retry failed request
- Settings modal for theme, model, temperature, max tokens, system prompt, and clearing chats
- File and image upload UI with drag and drop support
- Browser speech recognition voice input where supported
- Request validation, duplicate-request prevention, error states, retry actions, and in-memory rate limiting

## Run locally

Set `GROQ_API_KEY`, then start ChickenGPT:

```powershell
$env:GROQ_API_KEY="gsk-your-key-here"
npm start
```

Open `http://localhost:5173`.

## Configuration

Required:

```powershell
GROQ_API_KEY=gsk-your-key-here
```

Optional:

```powershell
PORT=5173
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=30
```

Supported Groq models in the UI:

- `llama-3.3-70b-versatile`
- `llama-3.1-8b-instant`
- `gemma2-9b-it`

## Deploy on Render

Use this repo as a Render Web Service, not a Static Site.

- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/healthz`
- Required environment variable: `GROQ_API_KEY`
- Optional environment variables: `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`

The app has no new npm dependencies. Markdown, sanitization, and highlighting are loaded from CDN in the browser.

## Folder structure

```text
ChickenGPT/
  public/
    app.js
    index.html
    styles.css
  .env.example
  package.json
  Procfile
  README.md
  render.yaml
  server.js
```
