export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Auto Join Acceptor Cloudflare Worker Active!', { status: 200 });
    }

    try {
      const update = await request.json();
      const token = env.BOT_TOKEN;

      // 1. Handle Join Request: Send Clean Verification
      if (update.chat_join_request) {
        const req = update.chat_join_request;
        const chatId = req.chat.id;
        const userId = req.from.id;
        const title = req.chat.title || 'the chat';

        const name = (update.chat_join_request.from && update.chat_join_request.from.first_name) || 'there';
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: userId,
            text: `👋 Hello ${name}, to complete your request and join <b>${title}</b>, please verify that you are human below:`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: "I'm not a robot ✅", callback_data: `verify_${chatId}` }]]
            }
          })
        });
      }

      // 2. Handle Verification Button Click: Instant Alert
      if (update.callback_query && update.callback_query.data.startsWith('verify_')) {
        const cb = update.callback_query;
        const chatId = cb.data.replace('verify_', '');
        const userId = cb.from.id;

        // Approve user in channel/group
        await fetch(`https://api.telegram.org/bot${token}/approveChatJoinRequest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, user_id: userId })
        });

        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cb.id, text: '🎉 Verified! Access Granted!' })
        });

        await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cb.message.chat.id,
            message_id: cb.message.message_id,
            text: `✅ <b>Approved</b>\n\nYour request has been approved!`,
            parse_mode: 'HTML'
          })
        });
      }

      // User Start Command
      if (update.message && update.message.text && update.message.text.startsWith('/start')) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: update.message.chat.id,
            text: '⚡ <b>Auto Request Acceptor</b>\n\nI automatically approve join requests for your Telegram channels and groups instantly.\n\nJust add me as an administrator with invite users permission to get started!',
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '➕ Add to Channel', url: 'https://t.me/AutoApproverProBot?startchannel&admin=invite_users+manage_chat' },
                  { text: '➕ Add to Group', url: 'https://t.me/AutoApproverProBot?startgroup&admin=invite_users+manage_chat' }
                ],
                [
                  { text: '🛠️ RH Tools', url: 'https://t.me/RHToolsOfficial' },
                  { text: '📖 How to Setup', callback_data: 'user_guide' }
                ]
              ]
            }
          })
        });
      }

      return new Response('OK', { status: 200 });
    } catch (err) {
      return new Response('Error: ' + err.message, { status: 200 });
    }
  }
};
