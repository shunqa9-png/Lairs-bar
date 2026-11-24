const { Pool } = require("pg");

const ssl = String(process.env.PG_SSL || "true").toLowerCase() === "true";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: ssl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      language TEXT NOT NULL DEFAULT 'uz',
      games_played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS groups (
      chat_id BIGINT PRIMARY KEY,
      title TEXT,
      language TEXT NOT NULL DEFAULT 'uz',
      bot_is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      status TEXT NOT NULL,
      language TEXT NOT NULL,
      state JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS games_chat_status_idx ON games(chat_id, status);
  `);
}

async function upsertUser(u, language) {
  await pool.query(`
    INSERT INTO users (telegram_id, username, first_name, language, last_seen)
    VALUES ($1,$2,$3,COALESCE($4,'uz'),NOW())
    ON CONFLICT (telegram_id) DO UPDATE SET
      username=EXCLUDED.username, first_name=EXCLUDED.first_name,
      language=COALESCE($4, users.language), last_seen=NOW()
  `, [u.id, u.username || null, u.first_name || "Player", language || null]);
}
async function getUser(id) {
  const r = await pool.query("SELECT * FROM users WHERE telegram_id=$1", [id]);
  return r.rows[0] || null;
}
async function setUserLanguage(id, lang) {
  await pool.query("UPDATE users SET language=$2 WHERE telegram_id=$1", [id, lang]);
}
async function upsertGroup(chat, isAdmin=false) {
  await pool.query(`
    INSERT INTO groups(chat_id,title,bot_is_admin) VALUES($1,$2,$3)
    ON CONFLICT(chat_id) DO UPDATE SET title=EXCLUDED.title, bot_is_admin=EXCLUDED.bot_is_admin
  `, [chat.id, chat.title || "Group", isAdmin]);
}
async function setGroupLanguage(id, lang) {
  await pool.query("UPDATE groups SET language=$2 WHERE chat_id=$1", [id, lang]);
}
async function getGroup(id) {
  const r = await pool.query("SELECT * FROM groups WHERE chat_id=$1", [id]);
  return r.rows[0] || null;
}
async function saveGame(game) {
  await pool.query(`
    INSERT INTO games(id,chat_id,status,language,state,updated_at)
    VALUES($1,$2,$3,$4,$5,NOW())
    ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status, state=EXCLUDED.state, updated_at=NOW()
  `, [game.id, game.chatId, game.status, game.language, JSON.stringify(game)]);
}
async function loadActiveGames() {
  const r = await pool.query("SELECT state FROM games WHERE status IN ('lobby','playing')");
  return r.rows.map(x => x.state);
}
async function getActiveGame(chatId) {
  const r = await pool.query("SELECT state FROM games WHERE chat_id=$1 AND status IN ('lobby','playing') ORDER BY updated_at DESC LIMIT 1", [chatId]);
  return r.rows[0]?.state || null;
}
async function finishGame(game) {
  await pool.query("UPDATE games SET status='finished',state=$2,updated_at=NOW() WHERE id=$1", [game.id, JSON.stringify(game)]);
}
async function recordResult(players, winnerId) {
  const ids = players.map(p => p.id);
  if (!ids.length) return;
  await pool.query("UPDATE users SET games_played=games_played+1 WHERE telegram_id=ANY($1::bigint[])", [ids]);
  if (winnerId) await pool.query("UPDATE users SET wins=wins+1 WHERE telegram_id=$1", [winnerId]);
}
async function stats() {
  const [u,g,a] = await Promise.all([
    pool.query("SELECT COUNT(*)::int n FROM users"),
    pool.query("SELECT COUNT(*)::int n FROM groups"),
    pool.query("SELECT COUNT(*)::int n FROM games")
  ]);
  return { users:u.rows[0].n, groups:g.rows[0].n, games:a.rows[0].n };
}
async function allUserIds() {
  const r = await pool.query("SELECT telegram_id FROM users");
  return r.rows.map(x => String(x.telegram_id));
}
async function getSetting(key) {
  const r = await pool.query("SELECT value FROM settings WHERE key=$1", [key]);
  return r.rows[0]?.value || null;
}
async function setSetting(key,value) {
  await pool.query(`INSERT INTO settings(key,value) VALUES($1,$2)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [key,value]);
}
module.exports = { pool, initDb, upsertUser, getUser, setUserLanguage, upsertGroup, setGroupLanguage, getGroup, saveGame, loadActiveGames, getActiveGame, finishGame, recordResult, stats, allUserIds, getSetting, setSetting };
