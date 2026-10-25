# ⚡ Cloudflare Worker Telegram Auto Join Acceptor (100% Free Forever)

Deploy this to Cloudflare Workers for **$0 server cost, 24/7 100% uptime**, with zero sleeping.

### Deployment (Only 1 Minute):
1. Install Wrangler CLI (if not installed):
   ```bash
   npm install -g wrangler
   ```
2. Login to Cloudflare:
   ```bash
   wrangler login
   ```
3. Deploy:
   ```bash
   wrangler deploy
   ```
4. Set Telegram Webhook to your Worker URL:
   ```bash
   curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://YOUR_WORKER_URL.workers.dev&allowed_updates=\[\"chat_join_request\",\"callback_query\",\"message\",\"my_chat_member\"\]"
   ```
Done! Your bot now runs serverless on Cloudflare's edge network globally.
