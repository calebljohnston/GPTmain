# Vita SMS Server

Text with Vita, your AI health coach, directly from your phone via SMS.

This Node.js/Express server connects the Vita health agent to SMS using Twilio. It ports all the core logic from the browser app (health records, goals, tools, confirmation flow) to a server-side backend with SQLite storage and a YES/NO SMS confirmation flow.

---

## How It Works

1. **You text your Twilio number** → Twilio POSTs to this server's `/sms` endpoint
2. **Vita (Claude) responds** with health coaching, and calls tools when it wants to save data
3. **Confirmation tools** (recording vitals, adding goals, etc.) send you a YES/NO prompt
4. **You reply YES** → data is saved, Vita continues; **NO** → skipped, Vita acknowledges
5. **Reminder cron** fires SMS reminders at your scheduled task times

All health data is stored in a SQLite database keyed to your phone number.

---

## Prerequisites

- Node.js 18+
- A [Twilio account](https://www.twilio.com/) with a purchased phone number (~$1/month)
- An [Anthropic API key](https://console.anthropic.com/)
- [ngrok](https://ngrok.com/) for local development

---

## Local Development Setup

```bash
# 1. Install dependencies
cd sms-server
npm install

# 2. Create your .env file
cp .env.example .env
# Edit .env and fill in your API keys

# 3. Create the data directory for SQLite
mkdir -p data

# 4. Start the server
npm run dev
```

In a second terminal, start ngrok to expose your local server:

```bash
ngrok http 3000
# Copy the HTTPS forwarding URL, e.g. https://abc123.ngrok-free.app
```

Update your `.env`:
```
SERVER_URL=https://abc123.ngrok-free.app
```

Then restart `npm run dev`.

### Configure Twilio Webhook

1. Go to [Twilio Console](https://console.twilio.com/) → Phone Numbers → Active Numbers
2. Click your Twilio number
3. Under **Messaging Configuration** → **A message comes in**:
   - Set to: `Webhook`
   - URL: `https://abc123.ngrok-free.app/sms`
   - Method: `POST`
4. Click Save

Now text your Twilio number from your phone!

---

## Testing

```bash
# Check the server is running
curl http://localhost:3000/health
# → {"status":"ok","time":"..."}
```

Then text your Twilio number:
- "Hi, I'm [your name], I'm 35 years old" → Vita introduces itself
- "I weighed 82kg this morning" → Vita asks to confirm recording it
- Reply **YES** → weight saved, Vita responds
- Reply **NO** → Vita acknowledges without saving
- "Set me a goal to run a 5k" → `add_goal` confirmation flow
- "Add a daily 8am reminder to take my vitamins" → task + reminder created

---

## Deployment

### Railway (recommended)

1. Push the repo to GitHub
2. Create a new [Railway](https://railway.app/) project → "Deploy from GitHub repo"
3. Add a persistent volume at `/data`
4. Set environment variables in Railway dashboard:
   - All vars from `.env.example`
   - `DB_PATH=/data/vita.db`
   - `SERVER_URL=https://your-app.up.railway.app`
5. Railway auto-detects Node.js and uses `npm start`
6. Update your Twilio webhook URL to the Railway URL

### Render

1. Create a new Web Service on [Render](https://render.com/)
2. Build Command: `npm install`
3. Start Command: `node server.js`
4. Add a **Persistent Disk** mounted at `/data` (required — Render's filesystem is ephemeral)
5. Set environment variables
6. Note: Free tier spins down after 15 min inactivity — SMS reminders won't fire when spun down. Upgrade to paid for reliable reminders.

### Fly.io

```bash
cd sms-server
fly launch
fly volumes create vita_data --size 1
# Add to fly.toml: [mounts] source = "vita_data", destination = "/data"
fly secrets set ANTHROPIC_API_KEY=... TWILIO_AUTH_TOKEN=... # etc
fly deploy
```

---

## Architecture

```
sms-server/
├── server.js          # Express app, /sms webhook, YES/NO state machine
├── lib/
│   ├── db.js          # SQLite adapter (replaces browser localStorage)
│   ├── vita-core.js   # Health record, goals, tools — ported from browser JS
│   ├── anthropic.js   # Non-streaming Claude API loop with tool handling
│   ├── twilio.js      # sendSms() with automatic message splitting
│   └── reminders.js   # node-cron job for scheduled SMS reminders
└── data/
    └── vita.db        # SQLite database (auto-created on first run)
```

### Session State Machine

Each phone number has a session state stored in SQLite:

- **IDLE** — normal operation, next text starts a new Claude turn
- **PROCESSING** — Claude is currently responding (ignores duplicate texts)
- **AWAITING_CONFIRMATION** — waiting for YES/NO reply to a tool confirmation

### Confirmation Flow

When Claude wants to save data (e.g. record a weight), it calls a tool. The server intercepts this and texts you:

```
Vita wants to: Record your weight as 82 kg this morning.

Reply YES to confirm or NO to skip.
```

Confirmations expire after 10 minutes if not answered.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude |
| `TWILIO_ACCOUNT_SID` | Yes | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Yes | Your Twilio phone number (E.164 format) |
| `PORT` | No | Server port (default: 3000) |
| `SERVER_URL` | Recommended | Your public URL for Twilio webhook validation |
| `DB_PATH` | No | SQLite file path (default: `./data/vita.db`) |
