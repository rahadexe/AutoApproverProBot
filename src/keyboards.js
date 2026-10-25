const { Keyboard, InlineKeyboard } = require('grammy');

function getReplyKeyboard(isAdmin = false) {
  if (isAdmin) {
    return new Keyboard().text('Admin Panel').resized().persistent();
  }
  return { remove_keyboard: true };
}

function getMainMenu(isAdmin = false) {
  return getReplyKeyboard(isAdmin);
}

// User Start Screen (Clean Promotional Style)
function getStartInlineKeyboard(botUsername = 'AutoApproverProBot', promo = null, isAdmin = false) {
  const kb = new InlineKeyboard()
    .url('➕ Add to Channel', `https://t.me/${botUsername}?startchannel&admin=invite_users+manage_chat`)
    .url('➕ Add to Group', `https://t.me/${botUsername}?startgroup&admin=invite_users+manage_chat`)
    .row();

  const promoUrl = promo && promo.url ? promo.url : null;
  const promoTitle = promo && promo.title ? promo.title : '📢 Channel Updates';

  // Dedicated full-width row for sponsor so long titles never get squeezed or cut off
  if (promoUrl) {
    kb.url(promoTitle, promoUrl).row();
  }

  kb.text('📖 How to Setup', 'user_guide');

  if (isAdmin) {
    kb.row().text('🛠️ Admin Panel', 'adm_open_panel');
  }

  return kb;
}

// User My Channels / My Groups List Keyboard
function getMyChatsKeyboard(chats, type = 'channel', page = 0, perPage = 5, botUsername = 'AutoApproverProBot') {
  const kb = new InlineKeyboard();
  const isGroup = type === 'group';

  if (!chats || chats.length === 0) {
    const addLabel = isGroup ? '➕ Add Group' : '➕ Add Channel';
    const addParam = isGroup ? 'startgroup&admin=invite_users+manage_chat' : 'startchannel&admin=invite_users+manage_chat';
    kb.url(addLabel, `https://t.me/${botUsername}?${addParam}`).row();
    kb.text('« Back', 'user_back');
    return kb;
  }

  const totalPages = Math.ceil(chats.length / perPage) || 1;
  const start = page * perPage;
  const paged = chats.slice(start, start + perPage);

  paged.forEach((c) => {
    const modeLabel = c.mode === 'captcha' ? 'Captcha' : 'Instant';
    kb.text(`${c.title} • ${modeLabel}`, `user_chat_view_${c.chat_id}_${type}_${page}`).row();
  });

  if (totalPages > 1) {
    const navRow = [];
    if (page > 0) {
      navRow.push({ text: '« Prev', callback_data: `user_my_${type}s_${page - 1}` });
    }
    navRow.push({ text: `${page + 1}/${totalPages}`, callback_data: `user_noop` });
    if (page < totalPages - 1) {
      navRow.push({ text: 'Next »', callback_data: `user_my_${type}s_${page + 1}` });
    }
    navRow.forEach(btn => kb.text(btn.text, btn.callback_data));
    kb.row();
  }

  kb.text('« Back', 'user_back');
  return kb;
}

// User Single Chat Detail & Mode Toggle Keyboard
function getMyChatDetailKeyboard(chatId, currentMode, type = 'channel', page = 0) {
  const isCaptcha = currentMode === 'captcha';
  const toggleLabel = isCaptcha ? '⚡ Switch to Instant Mode' : '🛡️ Switch to Captcha Mode';
  const backLabel = type === 'group' ? '« Back to Groups' : '« Back to Channels';
  return new InlineKeyboard()
    .text(toggleLabel, `user_toggle_mode_${chatId}_${type}_${page}`).row()
    .text(backLabel, `user_my_${type}s_${page}`);
}

function getGuideBackKeyboard() {
  return new InlineKeyboard().text('« Back', 'user_back');
}

function getCaptchaKeyboard(chatId) {
  return new InlineKeyboard()
    .text("I'm not a robot ✅", `verify_human_${chatId}`);
}

function getApprovedKeyboard(channelUrl, botUsername = 'AutoApproverProBot', promo = null, showViral = true, isGroup = false) {
  const kb = new InlineKeyboard();
  const enterLabel = isGroup ? '🚀 Enter Group ➔' : '🚀 Enter Channel ➔';

  if (channelUrl && promo && promo.url) {
    kb.url(enterLabel, channelUrl).url(promo.title || 'Channel', promo.url).row();
  } else if (channelUrl) {
    kb.url(enterLabel, channelUrl).row();
  } else if (promo && promo.url) {
    kb.url(promo.title || 'Channel', promo.url).row();
  }

  if (showViral) {
    kb.url('⚡ Add to Your Chat', `https://t.me/${botUsername}?startgroup=true&admin=invite_users`);
  }

  return kb;
}

// Admin Console Menu (Full width stacked: Broadcast, Settings, Refresh, Back)
function getAdminConsoleMenu() {
  return new InlineKeyboard()
    .text('📢 Broadcast', 'adm_broadcast').row()
    .text('⚙️ Settings', 'adm_settings').row()
    .text('🔄 Refresh', 'adm_refresh').row()
    .text('« Back', 'adm_to_home');
}

// Paginated Chats Keyboard for Admin
function getChatsPaginatedKeyboard(channels, page = 0, perPage = 5) {
  const kb = new InlineKeyboard();
  const totalPages = Math.ceil(channels.length / perPage) || 1;
  const start = page * perPage;
  const paged = channels.slice(start, start + perPage);

  paged.forEach((c) => {
    const isGroup = ['group', 'supergroup'].includes(c.chat_type);
    const badge = isGroup ? 'Group' : 'Channel';
    const modeLabel = c.mode === 'captcha' ? 'Captcha' : 'Instant';
    kb.text(`${c.title} (${badge}) • ${modeLabel}`, `adm_ch_view_${c.chat_id}_${page}`).row();
  });

  if (totalPages > 1) {
    const navRow = [];
    if (page > 0) {
      navRow.push({ text: '« Prev', callback_data: `adm_channels_p_${page - 1}` });
    }
    navRow.push({ text: `${page + 1}/${totalPages}`, callback_data: `adm_channels_noop` });
    if (page < totalPages - 1) {
      navRow.push({ text: 'Next »', callback_data: `adm_channels_p_${page + 1}` });
    }
    navRow.forEach(btn => kb.text(btn.text, btn.callback_data));
    kb.row();
  }

  kb.text('« Back', 'adm_back');
  return kb;
}

// Single Channel Detail Keyboard for Admin
function getChannelDetailKeyboard(chatId, currentMode, page = 0) {
  const isCaptcha = currentMode === 'captcha';
  const toggleLabel = isCaptcha ? '⚡ Switch to Instant Mode' : '🛡️ Switch to Captcha Mode';
  return new InlineKeyboard()
    .text(toggleLabel, `adm_toggle_mode_${chatId}_${page}`).row()
    .text('« Back to Chats', `adm_channels_p_${page}`);
}

function getSettingsMenu(promoUrl, creatorTag = '', promoTitle = '') {
  const kb = new InlineKeyboard();

  if (promoUrl) {
    kb.text('🏷️ Change Button Title', 'adm_set_promo_title').row()
      .text('❌ Remove Sponsor', 'adm_remove_promo').row();
  } else {
    kb.text('➕ Set Sponsor Link', 'adm_set_promo').row();
  }

  kb.text(creatorTag ? `👤 Creator: ${creatorTag}` : '👤 Set Creator Tag', 'adm_set_creator')
    .row()
    .text('« Back', 'adm_back');

  return kb;
}

// Backward-compatibility for test suite
function getChannelConfigKeyboard(chatId, currentMode) {
  return getChannelDetailKeyboard(chatId, currentMode, 0);
}

function getBackToConsoleKeyboard() {
  return new InlineKeyboard().text('« Back', 'adm_back');
}

function getCancelKeyboard(backCallback = 'adm_back') {
  return new InlineKeyboard().text('❌ Cancel', backCallback);
}

function getBroadcastConfirmKeyboard(button = null, autoDeleteTimer = 600) {
  const kb = new InlineKeyboard();

  // Show the actual button in the preview if attached
  if (button && button.text && button.url) {
    kb.url(button.text, button.url).row();
  }

  const timerLabels = {
    600: '⏳ Auto-Delete: 10m',
    1800: '⏳ Auto-Delete: 30m',
    3600: '⏳ Auto-Delete: 1h',
    0: '⏳ Auto-Delete: Off'
  };
  const timerLabel = timerLabels[autoDeleteTimer] || '⏳ Auto-Delete: 10m';

  kb.text(timerLabel, 'adm_bc_toggle_timer').row();

  if (button) {
    kb.text('✏️ Change Button', 'adm_bc_add_btn').row()
      .text('🗑️ Remove Button', 'adm_bc_remove_btn').row();
  } else {
    kb.text('➕ Add Button', 'adm_bc_add_btn').row();
  }

  kb.text('🚀 Confirm and Send', 'adm_confirm_broadcast').row()
    .text('❌ Cancel', 'adm_cancel_broadcast');

  return kb;
}

module.exports = {
  getMainMenu,
  getReplyKeyboard,
  getStartInlineKeyboard,
  getMyChatsKeyboard,
  getMyChatDetailKeyboard,
  getGuideBackKeyboard,
  getCaptchaKeyboard,
  getApprovedKeyboard,
  getAdminConsoleMenu,
  getChatsPaginatedKeyboard,
  getChannelDetailKeyboard,
  getSettingsMenu,
  getChannelConfigKeyboard,
  getBackToConsoleKeyboard,
  getCancelKeyboard,
  getBroadcastConfirmKeyboard
};
