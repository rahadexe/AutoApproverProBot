const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'approver.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      is_verified INTEGER DEFAULT 0,
      total_requests INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS channels (
      chat_id INTEGER PRIMARY KEY,
      title TEXT,
      username TEXT,
      mode TEXT DEFAULT 'captcha', -- 'captcha' or 'instant'
      total_approved INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS join_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(chat_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS auto_deletions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      delete_at INTEGER NOT NULL
    );
  `);

  // Safe migrations for group support, private invite links, and chat owner tracking
  try { db.exec("ALTER TABLE channels ADD COLUMN chat_type TEXT DEFAULT 'channel'"); } catch {}
  try { db.exec("ALTER TABLE channels ADD COLUMN invite_link TEXT"); } catch {}
  try { db.exec("ALTER TABLE channels ADD COLUMN owner_id INTEGER DEFAULT 0"); } catch {}
}

function getSetting(key, defaultValue = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

// User ops
function upsertUser(telegramId, username, firstName, isVerified = false) {
  const stmt = db.prepare(`
    INSERT INTO users (telegram_id, username, first_name, is_verified)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      total_requests = total_requests + 1
  `);
  stmt.run(telegramId, username || null, firstName || '', isVerified ? 1 : 0);
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

function markUserVerified(telegramId) {
  db.prepare('UPDATE users SET is_verified = 1 WHERE telegram_id = ?').run(telegramId);
}

function getUser(telegramId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

// Channel ops
function upsertChannel(chatId, title, username, chatType = 'channel', inviteLink = null, ownerId = null) {
  const existing = db.prepare('SELECT * FROM channels WHERE chat_id = ?').get(chatId);
  const type = chatType || (existing ? existing.chat_type : 'channel');
  const link = inviteLink || (existing ? existing.invite_link : null);
  const owner = ownerId || (existing ? existing.owner_id : 0);

  const stmt = db.prepare(`
    INSERT INTO channels (chat_id, title, username, chat_type, invite_link, owner_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      title = excluded.title,
      username = coalesce(excluded.username, channels.username),
      chat_type = coalesce(excluded.chat_type, channels.chat_type),
      invite_link = coalesce(excluded.invite_link, channels.invite_link),
      owner_id = coalesce(excluded.owner_id, channels.owner_id)
  `);
  stmt.run(chatId, title || 'Chat', username || null, type, link, owner);
  return db.prepare('SELECT * FROM channels WHERE chat_id = ?').get(chatId);
}

function setChannelInviteLink(chatId, inviteLink) {
  db.prepare('UPDATE channels SET invite_link = ? WHERE chat_id = ?').run(inviteLink, chatId);
  return getChannel(chatId);
}

function getChannel(chatId) {
  return db.prepare('SELECT * FROM channels WHERE chat_id = ?').get(chatId);
}

function setChannelMode(chatId, mode) {
  db.prepare('UPDATE channels SET mode = ? WHERE chat_id = ?').run(mode, chatId);
  return getChannel(chatId);
}

function getAllChannels() {
  return db.prepare('SELECT * FROM channels ORDER BY created_at DESC').all();
}

function getChatsByType(type, userId = 0, adminId = 0) {
  const isGlobalAdmin = (userId === adminId && adminId !== 0);
  if (type === 'group') {
    if (isGlobalAdmin) {
      return db.prepare("SELECT * FROM channels WHERE chat_type IN ('group', 'supergroup') ORDER BY created_at DESC").all();
    }
    return db.prepare("SELECT * FROM channels WHERE chat_type IN ('group', 'supergroup') AND (owner_id = ? OR owner_id = 0) ORDER BY created_at DESC").all(userId);
  }
  if (isGlobalAdmin) {
    return db.prepare("SELECT * FROM channels WHERE chat_type = 'channel' ORDER BY created_at DESC").all();
  }
  return db.prepare("SELECT * FROM channels WHERE chat_type = 'channel' AND (owner_id = ? OR owner_id = 0) ORDER BY created_at DESC").all(userId);
}

function removeChannel(chatId) {
  db.prepare('DELETE FROM channels WHERE chat_id = ?').run(chatId);
}

// Join Request ops
function recordJoinRequest(chatId, userId) {
  const stmt = db.prepare(`
    INSERT INTO join_requests (chat_id, user_id, status)
    VALUES (?, ?, 'pending')
    ON CONFLICT(chat_id, user_id) DO UPDATE SET
      status = 'pending',
      created_at = CURRENT_TIMESTAMP
  `);
  const info = stmt.run(chatId, userId);
  return info.changes > 0;
}

function getPendingRequest(chatId, userId) {
  return db.prepare("SELECT * FROM join_requests WHERE chat_id = ? AND user_id = ? AND status = 'pending'").get(chatId, userId);
}

function approveRequest(chatId, userId) {
  db.prepare("UPDATE join_requests SET status = 'approved' WHERE chat_id = ? AND user_id = ?").run(chatId, userId);
  db.prepare("UPDATE channels SET total_approved = total_approved + 1 WHERE chat_id = ?").run(chatId);
  markUserVerified(userId);
}

function getStats() {
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const verifiedUsers = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_verified = 1').get().c;
  const totalChannels = db.prepare('SELECT COUNT(*) as c FROM channels').get().c;
  const totalApproved = db.prepare("SELECT COUNT(*) as c FROM join_requests WHERE status = 'approved'").get().c;
  const pendingRequests = db.prepare("SELECT COUNT(*) as c FROM join_requests WHERE status = 'pending'").get().c;

  return { totalUsers, verifiedUsers, totalChannels, totalApproved, pendingRequests };
}

function getAllUserIds() {
  return db.prepare('SELECT telegram_id FROM users').all().map(r => r.telegram_id);
}

function recordAutoDeletion(chatId, messageId, deleteAt) {
  db.prepare('INSERT INTO auto_deletions (chat_id, message_id, delete_at) VALUES (?, ?, ?)').run(chatId, messageId, deleteAt);
}

function getDueAutoDeletions(nowSeconds) {
  return db.prepare('SELECT * FROM auto_deletions WHERE delete_at <= ?').all(nowSeconds);
}

function removeAutoDeletion(id) {
  db.prepare('DELETE FROM auto_deletions WHERE id = ?').run(id);
}

module.exports = {
  initDb,
  getSetting,
  setSetting,
  upsertUser,
  markUserVerified,
  getUser,
  upsertChannel,
  getChannel,
  setChannelInviteLink,
  setChannelMode,
  getAllChannels,
  getChatsByType,
  removeChannel,
  recordJoinRequest,
  getPendingRequest,
  approveRequest,
  getStats,
  getAllUserIds,
  recordAutoDeletion,
  getDueAutoDeletions,
  removeAutoDeletion
};
