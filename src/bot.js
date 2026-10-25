require('dotenv').config();
const { Bot } = require('grammy');
const db = require('./db');
const keyboards = require('./keyboards');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
  console.log('Notice: BOT_TOKEN is not configured yet in /data/bot-auto-approver/.env');
}

const ADMIN_ID = parseInt(process.env.ADMIN_ID || '0', 10);

db.initDb();
const bot = new Bot(BOT_TOKEN || '123456:dummy');

const userStates = new Map();

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ----------------------------------------------------
// 1. Join Request Listener (Captcha Gate — No Auto-Approve without Button Press!)
// ----------------------------------------------------
bot.on('chat_join_request', async (ctx) => {
  const req = ctx.chatJoinRequest;
  const user = req.from;
  const chat = req.chat;
  const isGroup = ['group', 'supergroup'].includes(chat.type);
  const inviteLink = req.invite_link ? req.invite_link.invite_link : null;

  // 1. Register chat, user & pending request in database
  db.upsertChannel(chat.id, chat.title, chat.username, chat.type, inviteLink);
  db.upsertUser(user.id, user.username, user.first_name, false);
  db.recordJoinRequest(chat.id, user.id);

  const ch = db.getChannel(chat.id);
  const mode = ch ? ch.mode : 'captcha';

  // Instant Mode: Approve immediately without any buttons
  if (mode === 'instant') {
    try {
      await ctx.api.approveChatJoinRequest(chat.id, user.id);
      db.approveRequest(chat.id, user.id);
      await ctx.api.sendMessage(
        user.id,
        `Your request to join <b>${escapeHtml(chat.title)}</b> has been approved ✅`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      console.warn(`Instant approve failed for ${user.id}:`, err.message);
    }
    return;
  }

  // Captcha Mode: Send Clean Verification Button
  try {
    const name = user.first_name ? escapeHtml(user.first_name) : 'there';
    await ctx.api.sendMessage(
      user.id,
      `👋 Hello ${name}, to complete your request and join <b>${escapeHtml(chat.title)}</b>, please verify that you are human below:`,
      {
        parse_mode: 'HTML',
        reply_markup: keyboards.getCaptchaKeyboard(chat.id)
      }
    );
  } catch (err) {
    console.warn(`Could not DM user ${user.id} (privacy/blocked):`, err.message);
    // User privacy fallback: auto-approve immediately so they are never locked out!
    try {
      await ctx.api.approveChatJoinRequest(chat.id, user.id);
      db.approveRequest(chat.id, user.id);
    } catch {}
  }
});

// ----------------------------------------------------
// 2. Captcha Verification Callback ("Verify to Join")
// ----------------------------------------------------
bot.callbackQuery(/^verify_human_(-?\d+)$/, async (ctx) => {
  const chatId = parseInt(ctx.match[1], 10);
  const userId = ctx.from.id;
  const channel = db.getChannel(chatId);
  const channelTitle = channel ? channel.title : 'the chat';

  try {
    // Approve user join request ONLY AFTER they tap the button!
    await ctx.api.approveChatJoinRequest(chatId, userId);
    db.approveRequest(chatId, userId);

    // Tactile feedback: Instant native alert
    await ctx.answerCallbackQuery({ text: `🎉 Verified! Welcome to ${channelTitle}` });

    // Clean confirmation with ZERO broken buttons
    await ctx.editMessageText(
      `✅ <b>Approved</b>\n\n` +
      `Your request to join <b>${escapeHtml(channelTitle)}</b> has been approved!`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.warn('Approve join request error:', err.message);

    // If request was already approved or expired
    if (err.message.includes('USER_ALREADY_PARTICIPANT') || err.message.includes('HIDE_REQUESTER_MISSING')) {
      await ctx.answerCallbackQuery({ text: 'Already verified' });
      return ctx.editMessageText(
        `✅ <b>Approved</b>\n\n` +
        `Your request to join <b>${escapeHtml(channelTitle)}</b> has been approved!`,
        { parse_mode: 'HTML' }
      );
    }

    await ctx.answerCallbackQuery({ text: 'Could not verify request', show_alert: true });
  }
});

// ----------------------------------------------------
// 3. Channel/Group Admin Status Listener
// ----------------------------------------------------
bot.on('my_chat_member', async (ctx) => {
  const update = ctx.myChatMember;
  if (!update || update.chat.type === 'private') return;

  const newStatus = update.new_chat_member.status;
  if (['administrator'].includes(newStatus)) {
    const ownerId = update.from ? update.from.id : null;
    db.upsertChannel(update.chat.id, update.chat.title, update.chat.username, update.chat.type, null, ownerId);
    console.log(`✅ Bot added as admin to: ${update.chat.title} (${update.chat.id}) [${update.chat.type}] by ${ownerId}`);

    // Silent on success; alert ONLY if "Invite Users via Links" permission is missing
    const canInvite = update.new_chat_member.can_invite_users === true;
    if (!canInvite && update.from && update.from.id) {
      ctx.api.sendMessage(
        update.from.id,
        `⚠️ <b>Permission Needed</b>\n\nTo approve join requests in <b>${escapeHtml(update.chat.title)}</b>, please grant the "Invite Users via Links" admin permission.`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  } else if (['left', 'kicked', 'restricted', 'member'].includes(newStatus)) {
    db.removeChannel(update.chat.id);
    console.log(`ℹ️ Bot removed from: ${update.chat.title} (${update.chat.id})`);
  }
});

// ----------------------------------------------------
// 4. User Start Command & Navigation
// ----------------------------------------------------
function getWelcomeText() {
  const creator = db.getSetting('creator_tag', '');
  const creatorLine = (creator && creator.toLowerCase() !== 'none' && creator.trim() !== '')
    ? `\n\nCreated by ${escapeHtml(creator)}`
    : '';

  return (
    `⚡ <b>Auto Request Acceptor</b>\n\n` +
    `I automatically approve join requests for your Telegram channels and groups instantly.\n\n` +
    `Just add me as an administrator with invite users permission to get started!${creatorLine}`
  );
}

bot.command('start', async (ctx) => {
  if (ctx.chat.type !== 'private') return;

  const uid = ctx.from.id;
  const isAdmin = (uid === ADMIN_ID);
  db.upsertUser(uid, ctx.from.username, ctx.from.first_name, false);
  const botInfo = await ctx.api.getMe();
  const promoUrl = db.getSetting('promo_url', '');
  const promoTitle = db.getSetting('promo_title', '📢 Channel Updates');
  const promo = promoUrl ? { url: promoUrl, title: promoTitle } : null;

  await ctx.reply(
    getWelcomeText(),
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getStartInlineKeyboard(botInfo.username, promo, isAdmin)
    }
  );
});

bot.callbackQuery(/^user_my_(channels|groups)_(\d+)$/, async (ctx) => {
  const isGroup = ctx.match[1] === 'groups';
  const type = isGroup ? 'group' : 'channel';
  const page = parseInt(ctx.match[2], 10) || 0;
  const chats = db.getChatsByType(type, ctx.from.id, ADMIN_ID);
  const botInfo = await ctx.api.getMe();
  await ctx.answerCallbackQuery();

  const titleText = isGroup ? 'Connected Groups' : 'Connected Channels';
  const icon = isGroup ? '👥' : '📢';

  if (!chats || chats.length === 0) {
    const emptyText = isGroup ? 'No groups connected yet.' : 'No channels connected yet.';
    return ctx.editMessageText(
      emptyText,
      {
        parse_mode: 'HTML',
        reply_markup: keyboards.getMyChatsKeyboard(chats, type, page, 5, botInfo.username)
      }
    );
  }

  await ctx.editMessageText(
    `${icon} <b>${titleText} (${chats.length})</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getMyChatsKeyboard(chats, type, page, 5, botInfo.username)
    }
  );
});

bot.callbackQuery(/^user_chat_view_(-?\d+)_(channel|group)_(\d+)$/, async (ctx) => {
  const chatId = parseInt(ctx.match[1], 10);
  const type = ctx.match[2];
  const page = parseInt(ctx.match[3], 10) || 0;
  const ch = db.getChannel(chatId);
  if (!ch) return ctx.answerCallbackQuery({ text: 'Chat not found' });

  if (ch.owner_id && ch.owner_id !== ctx.from.id && ctx.from.id !== ADMIN_ID) {
    return ctx.answerCallbackQuery({ text: 'Access restricted to chat administrators.', show_alert: true });
  }

  await ctx.answerCallbackQuery();
  const isGroup = type === 'group';
  const icon = isGroup ? '👥' : '📢';
  const badge = isGroup ? 'Group' : 'Channel';
  const handle = ch.username ? `@${ch.username}` : (ch.invite_link ? 'Private Link' : `ID: ${ch.chat_id}`);
  const modeLabel = ch.mode === 'captcha' ? 'Captcha' : 'Instant';

  await ctx.editMessageText(
    `${icon} <b>${escapeHtml(ch.title)}</b> (${badge})\n\n` +
    `Link: ${handle}\n` +
    `Mode: ${modeLabel}\n` +
    `Approved: ${ch.total_approved}`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getMyChatDetailKeyboard(chatId, ch.mode, type, page)
    }
  );
});

bot.callbackQuery(/^user_toggle_mode_(-?\d+)_(channel|group)_(\d+)$/, async (ctx) => {
  const chatId = parseInt(ctx.match[1], 10);
  const type = ctx.match[2];
  const page = parseInt(ctx.match[3], 10) || 0;
  const ch = db.getChannel(chatId);
  if (!ch) return ctx.answerCallbackQuery({ text: 'Chat not found' });

  if (ch.owner_id && ch.owner_id !== ctx.from.id && ctx.from.id !== ADMIN_ID) {
    return ctx.answerCallbackQuery({ text: 'Access restricted to chat administrators.', show_alert: true });
  }

  const newMode = ch.mode === 'captcha' ? 'instant' : 'captcha';
  const updated = db.setChannelMode(chatId, newMode);

  await ctx.answerCallbackQuery({ text: `Mode: ${newMode.toUpperCase()}` });
  const isGroup = type === 'group';
  const icon = isGroup ? '👥' : '📢';
  const badge = isGroup ? 'Group' : 'Channel';
  const handle = updated.username ? `@${updated.username}` : (updated.invite_link ? 'Private Link' : `ID: ${updated.chat_id}`);
  const modeLabel = updated.mode === 'captcha' ? 'Captcha' : 'Instant';

  await ctx.editMessageText(
    `${icon} <b>${escapeHtml(updated.title)}</b> (${badge})\n\n` +
    `Link: ${handle}\n` +
    `Mode: ${modeLabel}\n` +
    `Approved: ${updated.total_approved}`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getMyChatDetailKeyboard(chatId, updated.mode, type, page)
    }
  );
});

bot.callbackQuery('user_noop', async (ctx) => {
  await ctx.answerCallbackQuery();
});

bot.callbackQuery('user_guide', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `📖 <b>How to Setup</b>\n\n` +
    `1. Add this bot to your group or channel as admin.\n` +
    `2. Allow permission: <b>Invite Users via Links</b>.\n` +
    `3. In group or channel settings, go to <b>Invite Links</b> and create a link with <b>Request Admin Approval</b> turned ON.\n\n` +
    `The bot will now verify and approve new members automatically.`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getGuideBackKeyboard()
    }
  );
});

bot.callbackQuery('user_back', async (ctx) => {
  await ctx.answerCallbackQuery();
  const botInfo = await ctx.api.getMe();
  const isAdmin = (ctx.from.id === ADMIN_ID);
  const promoUrl = db.getSetting('promo_url', '');
  const promoTitle = db.getSetting('promo_title', '📢 Channel Updates');
  const promo = promoUrl ? { url: promoUrl, title: promoTitle } : null;

  await ctx.editMessageText(
    getWelcomeText(),
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getStartInlineKeyboard(botInfo.username, promo, isAdmin)
    }
  );
});

bot.callbackQuery('adm_open_panel', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery({ text: 'Unauthorized' });
  await ctx.answerCallbackQuery();
  await renderAdmin(ctx);
});

bot.hears('How to Setup', async (ctx) => {
  await ctx.reply(
    `📖 <b>How to Setup</b>\n\n` +
    `1. Add this bot to your group or channel as admin (Invite Users permission).\n` +
    `2. Create an invite link with Request Admin Approval turned ON.\n` +
    `3. When users request to join, bot verifies them and approves instantly.`,
    { parse_mode: 'HTML' }
  );
});

// ----------------------------------------------------
// 5. Admin Console & Controls
// ----------------------------------------------------
async function renderAdmin(ctx, targetMessageId = null) {
  const s = db.getStats();
  const text =
    `Total Users: <b>${s.totalUsers}</b>\n` +
    `Verified Users: <b>${s.verifiedUsers}</b>\n` +
    `Connected Chats: <b>${s.totalChannels}</b>\n` +
    `Approved Requests: <b>${s.totalApproved}</b>`;

  if (targetMessageId) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, targetMessageId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboards.getAdminConsoleMenu()
      });
      return;
    } catch {}
  }

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: keyboards.getAdminConsoleMenu()
    });
  } else {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboards.getAdminConsoleMenu()
    });
  }
}

bot.hears('Admin Panel', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  await renderAdmin(ctx);
});

bot.callbackQuery('adm_back', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  userStates.delete(ctx.from.id);
  await ctx.answerCallbackQuery();
  await renderAdmin(ctx);
});

bot.callbackQuery('adm_to_home', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  userStates.delete(ctx.from.id);
  await ctx.answerCallbackQuery();
  const botInfo = await ctx.api.getMe();
  const promoUrl = db.getSetting('promo_url', '');
  const promoTitle = db.getSetting('promo_title', '📢 Channel Updates');
  const promo = promoUrl ? { url: promoUrl, title: promoTitle } : null;

  await ctx.editMessageText(
    getWelcomeText(),
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getStartInlineKeyboard(botInfo.username, promo, true)
    }
  );
});

bot.callbackQuery('adm_refresh', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  await ctx.answerCallbackQuery({ text: 'Stats refreshed' });
  await renderAdmin(ctx);
});

// Chats List Handler (Paginated, clean buttons only, no duplicate text)
bot.callbackQuery(/^adm_channels(?:_p_(\d+))?$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const page = ctx.match[1] ? parseInt(ctx.match[1], 10) : 0;
  const channels = db.getAllChannels();
  await ctx.answerCallbackQuery();

  if (channels.length === 0) {
    return ctx.editMessageText(
      `<b>No Chats Connected</b>\n\n` +
      `Add this bot as admin to your channel or group with Invite Users permission to get started.`,
      {
        parse_mode: 'HTML',
        reply_markup: keyboards.getBackToConsoleKeyboard()
      }
    );
  }

  await ctx.editMessageText(
    `<b>Connected Chats (${channels.length})</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getChatsPaginatedKeyboard(channels, page)
    }
  );
});

bot.callbackQuery('adm_channels_noop', async (ctx) => {
  await ctx.answerCallbackQuery();
});

// Single Channel Detail View
bot.callbackQuery(/^adm_ch_view_(-?\d+)_(\d+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const chatId = parseInt(ctx.match[1], 10);
  const page = parseInt(ctx.match[2], 10);
  const ch = db.getChannel(chatId);
  if (!ch) return ctx.answerCallbackQuery({ text: 'Chat not found' });

  await ctx.answerCallbackQuery();
  const isGroup = ['group', 'supergroup'].includes(ch.chat_type);
  const badge = isGroup ? 'Group' : 'Channel';
  const handle = ch.username ? `@${ch.username}` : (ch.invite_link ? 'Private Link' : `ID: ${ch.chat_id}`);
  const modeLabel = ch.mode === 'captcha' ? 'Captcha (Tap button to join)' : 'Instant (Immediate approval)';

  await ctx.editMessageText(
    `<b>${escapeHtml(ch.title)}</b> (${badge})\n\n` +
    `Link: ${handle}\n` +
    `Mode: ${modeLabel}\n` +
    `Approved: ${ch.total_approved}\n\n` +
    `Tap below to toggle mode:`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getChannelDetailKeyboard(chatId, ch.mode, page)
    }
  );
});

// Toggle Channel Mode
bot.callbackQuery(/^adm_toggle_mode_(-?\d+)(?:_(\d+))?$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const chatId = parseInt(ctx.match[1], 10);
  const page = ctx.match[2] ? parseInt(ctx.match[2], 10) : 0;
  const ch = db.getChannel(chatId);
  if (!ch) return ctx.answerCallbackQuery({ text: 'Chat not found' });

  const newMode = ch.mode === 'captcha' ? 'instant' : 'captcha';
  const updated = db.setChannelMode(chatId, newMode);

  await ctx.answerCallbackQuery({ text: `Mode: ${newMode.toUpperCase()}` });
  const isGroup = ['group', 'supergroup'].includes(updated.chat_type);
  const badge = isGroup ? 'Group' : 'Channel';
  const handle = updated.username ? `@${updated.username}` : (updated.invite_link ? 'Private Link' : `ID: ${updated.chat_id}`);
  const modeLabel = updated.mode === 'captcha' ? 'Captcha (Tap button to join)' : 'Instant (Immediate approval)';

  await ctx.editMessageText(
    `<b>${escapeHtml(updated.title)}</b> (${badge})\n\n` +
    `Link: ${handle}\n` +
    `Mode: ${modeLabel}\n` +
    `Approved: ${updated.total_approved}\n\n` +
    `Tap below to toggle mode:`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getChannelDetailKeyboard(chatId, updated.mode, page)
    }
  );
});

// Render Settings Helper
async function renderSettings(ctx, targetMsgId = null) {
  const promoUrl = db.getSetting('promo_url', '');
  const promoTitle = db.getSetting('promo_title', '📢 Sponsored');
  const creatorTag = db.getSetting('creator_tag', '@RHToolsOfficial');

  let sponsorDetails = '<i>None</i>';
  if (promoUrl) {
    sponsorDetails = `<code>${escapeHtml(promoUrl)}</code>\nButton Title: <b>${escapeHtml(promoTitle)}</b>`;
  }

  const text = (
    `<b>Settings</b>\n\n` +
    `Verification: <b>Captcha (I'm not a robot ✅)</b>\n` +
    `Sponsor: ${sponsorDetails}\n` +
    `Creator: <b>${creatorTag ? escapeHtml(creatorTag) : '<i>None</i>'}</b>`
  );
  const kb = keyboards.getSettingsMenu(promoUrl, creatorTag, promoTitle);

  if (targetMsgId) {
    try {
      return await ctx.api.editMessageText(ctx.chat.id, targetMsgId, text, {
        parse_mode: 'HTML',
        reply_markup: kb
      });
    } catch {}
  }

  if (ctx.callbackQuery) {
    return ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  }

  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

bot.callbackQuery('adm_settings', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  await ctx.answerCallbackQuery();
  await renderSettings(ctx);
});

bot.callbackQuery('adm_remove_promo', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  db.setSetting('promo_url', '');
  await ctx.answerCallbackQuery({ text: 'Sponsor link removed' });
  await renderSettings(ctx);
});

bot.callbackQuery('adm_set_promo', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  await ctx.answerCallbackQuery();
  const msgId = ctx.callbackQuery.message.message_id;
  userStates.set(ctx.from.id, { action: 'awaiting_promo_url', messageId: msgId });

  await ctx.editMessageText(
    `<b>Set Sponsor Link</b>\n\n` +
    `Send the Telegram channel link you want to sponsor (e.g. https://t.me/yourchannel).\n\n` +
    `Or tap Cancel below:`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getCancelKeyboard('adm_cancel_settings')
    }
  );
});

bot.callbackQuery('adm_set_promo_title', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  await ctx.answerCallbackQuery();
  const msgId = ctx.callbackQuery.message.message_id;
  userStates.set(ctx.from.id, { action: 'awaiting_promo_title', messageId: msgId });

  await ctx.editMessageText(
    `<b>Set Promo Button Title</b>\n\n` +
    `Send the text for your promo button (e.g. <code>📢 Channel Updates</code> or <code>🚀 Official Channel</code>).\n\n` +
    `Or tap Cancel below:`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getCancelKeyboard('adm_cancel_settings')
    }
  );
});

bot.callbackQuery('adm_set_creator', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  await ctx.answerCallbackQuery();
  const msgId = ctx.callbackQuery.message.message_id;
  userStates.set(ctx.from.id, { action: 'awaiting_creator_tag', messageId: msgId });

  await ctx.editMessageText(
    `<b>Set Creator Credit</b>\n\n` +
    `Send your username or creator tag (e.g. <code>@rahad</code> or <code>@rahadtech</code>).\n` +
    `Or send <code>none</code> to hide creator credit.\n\n` +
    `Or tap Cancel below:`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getCancelKeyboard('adm_cancel_settings')
    }
  );
});

bot.callbackQuery('adm_cancel_settings', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  userStates.delete(ctx.from.id);
  await ctx.answerCallbackQuery({ text: 'Cancelled' });
  await renderSettings(ctx);
});

function renderBroadcastPreview(state) {
  const userIds = db.getAllUserIds();
  const timerLabels = {
    600: '10m',
    1800: '30m',
    3600: '1h',
    0: 'Off'
  };
  const timer = state.autoDeleteTimer !== undefined ? state.autoDeleteTimer : 600;
  const timerText = timerLabels[timer] || '10m';

  const bodyContent = state.type === 'text' 
    ? escapeHtml(state.text) 
    : (state.contentDesc || 'Media content');

  return (
    `📢 <b>Broadcast Preview</b> (${userIds.length} users • ⏳ ${timerText})\n\n` +
    `${bodyContent}`
  );
}

bot.callbackQuery('adm_broadcast', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  await ctx.answerCallbackQuery();
  const msgId = ctx.callbackQuery.message.message_id;
  const userIds = db.getAllUserIds();
  userStates.set(ctx.from.id, { action: 'awaiting_broadcast', messageId: msgId });

  await ctx.editMessageText(
    `<b>Broadcast Message</b> (${userIds.length} users)\n\n` +
    `Send your message, photo, video, or forward a post from a channel.\n\n` +
    `Your input message will be deleted automatically and replaced with the live preview.\n\n` +
    `Or tap Cancel below:`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getCancelKeyboard('adm_cancel_broadcast')
    }
  );
});

bot.callbackQuery('adm_bc_toggle_timer', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const state = userStates.get(ctx.from.id);
  if (!state || state.action !== 'confirm_broadcast') return ctx.answerCallbackQuery();

  // Cycle: 600 (10m) -> 1800 (30m) -> 3600 (1h) -> 0 (Off) -> 600 (10m)
  const cycle = [600, 1800, 3600, 0];
  const currentTimer = state.autoDeleteTimer !== undefined ? state.autoDeleteTimer : 600;
  const idx = cycle.indexOf(currentTimer);
  state.autoDeleteTimer = cycle[(idx + 1) % cycle.length];

  const alertLabels = { 600: 'Auto-Delete: 10m', 1800: 'Auto-Delete: 30m', 3600: 'Auto-Delete: 1h', 0: 'Auto-Delete: Off' };
  await ctx.answerCallbackQuery({ text: alertLabels[state.autoDeleteTimer] });

  await ctx.editMessageText(renderBroadcastPreview(state), {
    parse_mode: 'HTML',
    reply_markup: keyboards.getBroadcastConfirmKeyboard(state.button, state.autoDeleteTimer)
  });
});

bot.callbackQuery('adm_bc_remove_btn', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const state = userStates.get(ctx.from.id);
  if (!state || state.action !== 'confirm_broadcast') return ctx.answerCallbackQuery();

  state.button = null;
  await ctx.answerCallbackQuery({ text: 'Button removed' });

  await ctx.editMessageText(renderBroadcastPreview(state), {
    parse_mode: 'HTML',
    reply_markup: keyboards.getBroadcastConfirmKeyboard(null, state.autoDeleteTimer)
  });
});

bot.callbackQuery('adm_bc_add_btn', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const state = userStates.get(ctx.from.id);
  if (!state || state.action !== 'confirm_broadcast') return ctx.answerCallbackQuery();

  state.action = 'awaiting_bc_button';
  await ctx.answerCallbackQuery();

  await ctx.editMessageText(
    `<b>Add Inline Button</b>\n\n` +
    `Send the button text and link separated by " - ":\n\n` +
    `Example:\n` +
    `<code>Join RH Tools - https://t.me/RHToolsOfficial</code>\n\n` +
    `Or send <code>none</code> to remove button.\n\n` +
    `Or tap Cancel below:`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getCancelKeyboard('adm_bc_cancel_btn')
    }
  );
});

bot.callbackQuery('adm_bc_cancel_btn', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const state = userStates.get(ctx.from.id);
  if (!state) return ctx.answerCallbackQuery();

  state.action = 'confirm_broadcast';
  await ctx.answerCallbackQuery({ text: 'Cancelled' });
  await ctx.editMessageText(renderBroadcastPreview(state), {
    parse_mode: 'HTML',
    reply_markup: keyboards.getBroadcastConfirmKeyboard(state.button, state.autoDeleteTimer)
  });
});

bot.callbackQuery('adm_confirm_broadcast', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const state = userStates.get(ctx.from.id);
  if (!state || state.action !== 'confirm_broadcast') {
    return ctx.answerCallbackQuery({ text: 'No broadcast pending' });
  }

  userStates.delete(ctx.from.id);
  await ctx.answerCallbackQuery({ text: 'Starting broadcast...' });
  const userIds = db.getAllUserIds();

  const timerText = state.autoDeleteTimer > 0 
    ? `\nAuto-Delete: Scheduled in ${Math.round(state.autoDeleteTimer / 60)} minutes.` 
    : '';

  await ctx.editMessageText(
    `<b>Broadcasting...</b>\n\nSending to ${userIds.length} users. Please wait.${timerText}`,
    { parse_mode: 'HTML' }
  );

  let sent = 0;
  let failed = 0;
  const replyMarkup = state.button ? new InlineKeyboard().url(state.button.text, state.button.url) : undefined;
  const deleteAt = state.autoDeleteTimer > 0 ? Math.floor(Date.now() / 1000) + state.autoDeleteTimer : null;

  for (const id of userIds) {
    try {
      let sentMsg;
      if (state.type === 'text') {
        sentMsg = await ctx.api.sendMessage(id, state.text, {
          entities: state.entities,
          reply_markup: replyMarkup
        });
      } else {
        sentMsg = await ctx.api.copyMessage(id, state.sourceChatId, state.sourceMsgId, {
          reply_markup: replyMarkup
        });
      }
      sent++;
      if (deleteAt && sentMsg && sentMsg.message_id) {
        db.recordAutoDeletion(id, sentMsg.message_id, deleteAt);
      }
    } catch {
      failed++;
    }
    await new Promise(r => setTimeout(r, 40));
  }

  const autoDeleteNote = state.autoDeleteTimer > 0
    ? `\n⏳ Messages will auto-delete in <b>${Math.round(state.autoDeleteTimer / 60)} minutes</b>.`
    : '';

  await ctx.editMessageText(
    `<b>Broadcast Complete</b>\n\n` +
    `Sent: <b>${sent}</b>\n` +
    `Failed: <b>${failed}</b>\n` +
    `Total: <b>${userIds.length}</b>${autoDeleteNote}`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.getBackToConsoleKeyboard()
    }
  );
});

bot.callbackQuery('adm_cancel_broadcast', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  userStates.delete(ctx.from.id);
  await ctx.answerCallbackQuery({ text: 'Cancelled' });
  await renderAdmin(ctx);
});

// Handle text and media inputs for Admin operations
bot.on('message', async (ctx, next) => {
  if (ctx.chat.type !== 'private' || ctx.from.id !== ADMIN_ID) return next();

  const state = userStates.get(ctx.from.id);
  if (!state) return next();

  // 1. Handling Promo Link Input
  if (state.action === 'awaiting_promo_url') {
    const text = ctx.message.text ? ctx.message.text.trim() : '';
    if (text.toLowerCase() === '/cancel') {
      userStates.delete(ctx.from.id);
      try { await ctx.deleteMessage(); } catch {}
      return renderSettings(ctx, state.messageId);
    }
    if (text.toLowerCase() === 'none' || text.toLowerCase() === 'remove') {
      db.setSetting('promo_url', '');
    } else if (!text.startsWith('http://') && !text.startsWith('https://')) {
      return ctx.reply('Please send a valid link starting with https://t.me/... or "none" to remove.');
    } else {
      db.setSetting('promo_url', text);
      // Auto-detect channel title from Telegram if public handle
      let detectedTitle = null;
      try {
        const match = text.match(/t\.me\/([a-zA-Z0-9_]+)/);
        if (match && !match[1].startsWith('+')) {
          const chatInfo = await ctx.api.getChat(`@${match[1]}`);
          if (chatInfo && chatInfo.title) {
            detectedTitle = chatInfo.title;
          }
        }
      } catch {}
      db.setSetting('promo_title', detectedTitle ? `📢 ${detectedTitle}` : '📢 Sponsored');
    }

    userStates.delete(ctx.from.id);
    try { await ctx.deleteMessage(); } catch {}
    return renderSettings(ctx, state.messageId);
  }

  // 2. Handling Promo Button Title Input
  if (state.action === 'awaiting_promo_title') {
    const text = ctx.message.text ? ctx.message.text.trim() : '';
    if (text.toLowerCase() === '/cancel') {
      userStates.delete(ctx.from.id);
      try { await ctx.deleteMessage(); } catch {}
      return renderSettings(ctx, state.messageId);
    }

    db.setSetting('promo_title', text || '📢 Channel Updates');
    userStates.delete(ctx.from.id);
    try { await ctx.deleteMessage(); } catch {}
    return renderSettings(ctx, state.messageId);
  }

  // 3. Handling Creator Tag Input
  if (state.action === 'awaiting_creator_tag') {
    const text = ctx.message.text ? ctx.message.text.trim() : '';
    if (text.toLowerCase() === '/cancel') {
      userStates.delete(ctx.from.id);
      try { await ctx.deleteMessage(); } catch {}
      return renderSettings(ctx, state.messageId);
    }

    db.setSetting('creator_tag', text);
    userStates.delete(ctx.from.id);
    try { await ctx.deleteMessage(); } catch {}
    return renderSettings(ctx, state.messageId);
  }

  // 4. Handling Broadcast Inline Button Input
  if (state.action === 'awaiting_bc_button') {
    const text = ctx.message.text ? ctx.message.text.trim() : '';
    if (text.toLowerCase() === '/cancel') {
      state.action = 'confirm_broadcast';
      try { await ctx.deleteMessage(); } catch {}
      return ctx.api.editMessageText(
        ctx.chat.id,
        state.messageId,
        renderBroadcastPreview(state),
        {
          parse_mode: 'HTML',
          reply_markup: keyboards.getBroadcastConfirmKeyboard(state.button, state.autoDeleteTimer)
        }
      );
    }

    if (text.toLowerCase() === 'none' || text.toLowerCase() === 'remove') {
      state.button = null;
    } else {
      const parts = text.split('-').map(s => s.trim());
      if (parts.length < 2 || (!parts[1].startsWith('http://') && !parts[1].startsWith('https://'))) {
        return ctx.reply('Format must be: Button Text - https://t.me/...\n\nExample:\nJoin RH Tools - https://t.me/RHToolsOfficial\n\nOr send "none" to remove.');
      }
      state.button = { text: parts[0], url: parts[1] };
    }

    state.action = 'confirm_broadcast';
    try { await ctx.deleteMessage(); } catch {}
    return ctx.api.editMessageText(
      ctx.chat.id,
      state.messageId,
      renderBroadcastPreview(state),
      {
        parse_mode: 'HTML',
        reply_markup: keyboards.getBroadcastConfirmKeyboard(state.button, state.autoDeleteTimer)
      }
    );
  }

  // 5. Handling Broadcast Input: Show preview and ask for confirmation
  if (state.action === 'awaiting_broadcast') {
    if (ctx.message.text && ctx.message.text.toLowerCase() === '/cancel') {
      userStates.delete(ctx.from.id);
      try { await ctx.deleteMessage(); } catch {}
      return renderAdmin(ctx, state.messageId);
    }

    const sourceChatId = ctx.chat.id;
    const sourceMsgId = ctx.message.message_id;

    let isText = false;
    let mainText = '';
    let parsedButton = null;
    let contentDesc = 'Message';

    if (ctx.message.text) {
      isText = true;
      const rawText = ctx.message.text;
      const lines = rawText.split('\n');
      if (lines.length > 1) {
        const lastLine = lines[lines.length - 1].trim();
        const match = lastLine.match(/^(.+?)\s*-\s*(https?:\/\/.+)$/i);
        if (match) {
          parsedButton = { text: match[1].trim(), url: match[2].trim() };
          mainText = lines.slice(0, -1).join('\n').trim();
        } else {
          mainText = rawText;
        }
      } else {
        mainText = rawText;
      }
    } else if (ctx.message.photo) {
      contentDesc = 'Photo' + (ctx.message.caption ? ` ("${escapeHtml(ctx.message.caption.slice(0, 40))}")` : '');
    } else if (ctx.message.video) {
      contentDesc = 'Video' + (ctx.message.caption ? ` ("${escapeHtml(ctx.message.caption.slice(0, 40))}")` : '');
    } else if (ctx.message.document) {
      contentDesc = 'Document (' + escapeHtml(ctx.message.document.file_name || 'file') + ')';
    } else if (ctx.message.audio) {
      contentDesc = 'Audio';
    } else if (ctx.message.voice) {
      contentDesc = 'Voice';
    } else if (ctx.message.animation) {
      contentDesc = 'GIF';
    } else if (ctx.message.sticker) {
      contentDesc = 'Sticker';
    }

    // Always delete the admin's typed/forwarded message so their chat stays clean!
    try { await ctx.deleteMessage(); } catch {}

    userStates.set(ctx.from.id, {
      action: 'confirm_broadcast',
      type: isText ? 'text' : 'media',
      text: mainText,
      entities: ctx.message.entities,
      sourceChatId,
      sourceMsgId,
      contentDesc,
      button: parsedButton,
      autoDeleteTimer: 600, // DEFAULT 10 MINUTES!
      messageId: state.messageId
    });

    const previewState = userStates.get(ctx.from.id);
    const previewText = renderBroadcastPreview(previewState);

    if (state.messageId) {
      try {
        return await ctx.api.editMessageText(
          ctx.chat.id,
          state.messageId,
          previewText,
          {
            parse_mode: 'HTML',
            reply_markup: keyboards.getBroadcastConfirmKeyboard(previewState.button, previewState.autoDeleteTimer)
          }
        );
      } catch {}
    }

    return ctx.reply(previewText, {
      parse_mode: 'HTML',
      reply_markup: keyboards.getBroadcastConfirmKeyboard(previewState.button, previewState.autoDeleteTimer)
    });
  }

  return next();
});

bot.catch(err => console.error('Auto Approver Error:', err));

process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

if (require.main === module && BOT_TOKEN && BOT_TOKEN !== 'YOUR_BOT_TOKEN_HERE') {
  console.log('🚀 Starting Auto Approver & Captcha Bot...');

  // 1. Set default command (Only /start)
  bot.api.setMyCommands([
    { command: 'start', description: 'Start' }
  ], { scope: { type: 'default' } }).catch(() => {});

  // 2. Clear any chat-scoped commands for Admin so /admin never appears in command menu
  if (ADMIN_ID) {
    bot.api.deleteMyCommands({ scope: { type: 'chat', chat_id: ADMIN_ID } }).catch(() => {});
  }

  bot.start({
    allowed_updates: ['message', 'callback_query', 'chat_join_request', 'my_chat_member'],
    onStart: (info) => console.log(`✅ Auto-Approver Bot @${info.username} is running!`)
  });

  // Background Auto-Deletion Worker (Runs every 10 seconds)
  setInterval(async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const dues = db.getDueAutoDeletions(now);
      if (dues && dues.length > 0) {
        for (const item of dues) {
          try {
            await bot.api.deleteMessage(item.chat_id, item.message_id);
          } catch {}
          db.removeAutoDeletion(item.id);
          await new Promise(r => setTimeout(r, 40));
        }
      }
    } catch {}
  }, 10000);
}

module.exports = { bot };
