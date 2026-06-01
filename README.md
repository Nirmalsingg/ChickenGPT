# ChickenGPT

ChickenGPT is a polished AI chat web app with a tiny Node backend powered by Groq.

## Run it

Set `GROQ_API_KEY`, then start ChickenGPT:

```powershell
$env:GROQ_API_KEY="gsk-your-key-here"
npm start
```

Open `http://localhost:5173`.

## Configuration

ChickenGPT sends chat messages to Groq's chat completions API using `llama-3.3-70b-versatile`.

Optional `.env` values:

```powershell
PORT=5173
GROQ_API_KEY=gsk-your-key-here
```

## Deploy on Render

Use this repo as a Render Web Service, not a Static Site.

- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/healthz`
- Environment variable: `GROQ_API_KEY`

## Features

- ChatGPT-style chat workspace
- Saved local conversation history
- System prompt, temperature, max token, and model controls
- File text import for `.txt`, `.md`, `.json`, `.csv`, `.js`, `.ts`, `.html`, and `.css`
- Groq backend proxy using `llama-3.3-70b-versatile`
