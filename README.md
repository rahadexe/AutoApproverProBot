# AutoApprover Pro (@AutoApproverProBot)

> Autonomous Telegram Bot API 8.0 join-request engine with sub-50ms edge auto-approval, pre-admission DM captcha verification, and sovereign SQLite lead persistence.

---

## Architecture Overview

AutoApprover Pro intercepts incoming `chat_join_request` events from Telegram channels and supergroups, evaluates admission policies, and persists lead data without exposing channel member rosters to scraper networks.

```
Telegram Invite Link (Admin Approval Enabled)
                      │
                      ▼
            [chat_join_request]
                      │
                      ├──────────────────────────┐
                      ▼                          ▼
             [Instant 40ms Mode]        [Captcha Gate Mode]
                      │                          │
                      │                 Dispatch Interactive
                      │                  DM Verification Key
                      │                          │
                      │                 User taps [Verify Human]
                      │                          │
                      ▼                          ▼
               [approveChatJoinRequest API Call]
                      │
                      ▼
         [SQLite WAL Lead Persistence]
```

---

## Features

- **Sub-50ms Edge Execution:** Eliminates ad-spend conversion decay caused by manual approval queues.
- **Pre-Admission DM Captcha:** Isolates headless scraper bots from channel member directories.
- **Dual Mode per Channel:** Configure `Instant` or `Captcha` independently for each channel or group.
- **Sovereign Lead Database:** Captures permanent Telegram UIDs, handles, and timestamps into SQLite (WAL) for direct broadcast retargeting.
- **Official Bot API v8.0 Only:** 100% compliant with Telegram platform terms. Zero MTProto userbot sessions or ban risk.
- **Flexible Runtime:** Deploy as a standalone Node.js daemon or serverless Cloudflare Worker.

---

## Getting Started

### 1. Configuration
```bash
git clone https://github.com/rahadexe/AutoApproverProBot.git
cd AutoApproverProBot
cp .env.example .env
```

Edit `.env`:
```env
BOT_TOKEN=your_telegram_bot_token_from_botfather
ADMIN_ID=your_numerical_telegram_id
PORT=8788
```

### 2. Run via Node.js
```bash
npm install
npm start
```

### 3. Deploy on Cloudflare Workers
See [`cloudflare-worker/README.md`](cloudflare-worker/README.md) for full serverless deployment instructions.

### 4. Telegram Channel Setup
1. Add `@AutoApproverProBot` to your Channel or Supergroup as an **Administrator**.
2. Grant only the **Invite Users via Links** (`can_invite_users`) permission.
3. In Channel Settings ➔ **Invite Links** ➔ Create a link with **"Request Admin Approval"** toggled **ON**.

---

## Architecture & Documentation
- Detailed UI/UX architecture and psychological conversion specs: [`UX_PSYCHOLOGY_SPEC.md`](UX_PSYCHOLOGY_SPEC.md)
- Landing page source and hardware dark design: [`landing/index.html`](landing/index.html)

---

## License
MIT
