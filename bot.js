// bot.js - V16a (PikaShort) - Full production-ready
// Requirements: Node 18+, env TELEGRAM_BOT_TOKEN

const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const express = require("express");
const app = express();

// ---------------- CONFIG ----------------
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN required in env");
  process.exit(1);
}
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Branding & Admin
const BRAND_NAME = "PikaShort";
const ADMIN_PASSWORD = "afiya1310";
const ALLOWED_ADMIN_ID = 6358090699; // only this chat id can call /admin

// Files/dirs
const SRC_DIR = "./src";
const DB_PATH = path.join(SRC_DIR, "database.json");
const BACKUP_DIR = path.join(SRC_DIR, "backups");
if (!fs.existsSync(SRC_DIR)) fs.mkdirSync(SRC_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Defaults & toggles
const INACTIVE_DAYS = 3;
const INACTIVE_CHECK_INTERVAL_HOURS = 12;
const inactiveMessage =
  "👋 Hey! It’s been a while since you used me.\nNeed to shorten links? Just send me any URL 🔗\nI'm here to help 😎";

const BATCH_SIZE = 25;
const BATCH_DELAY_MS = 1000;
const AUTO_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SCHEDULE_CHECK_INTERVAL_MS = 60 * 1000;

let headerFooterEnabled = false;
let USE_LIVE_API_VALIDATION = true; // V16a: default true for strict validation

// ---------------- DB helpers ----------------
function readDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const db = JSON.parse(raw);
    db.tokens = db.tokens || {};
    db.lastActive = db.lastActive || {};
    db.admins = db.admins || [];
    db.adsMessage = db.adsMessage || `🔥 *${BRAND_NAME} SPECIAL!*  \nEarn More With SmallshortURL!  \nVisit 👉 https://smallshorturl.myvippanel.shop`;
    db.headerText = db.headerText || "not available now";
    db.footerText = db.footerText || "not available now";
    db.schedule = db.schedule || { enabled: false, time: null, timezone: "Asia/Kolkata" };
    db.adStats = db.adStats || { totalDelivered: 0, totalFailed: 0, history: [] };
    db.premium = db.premium || [];
    return db;
  } catch (e) {
    const init = {
      tokens: {},
      lastActive: {},
      admins: [String(ALLOWED_ADMIN_ID)],
      adsMessage: `🔥 *${BRAND_NAME} SPECIAL!*  \nEarn More With SmallshortURL!  \nVisit 👉 https://smallshorturl.myvippanel.shop`,
      headerText: "not available now",
      footerText: "not available now",
      schedule: { enabled: false, time: null, timezone: "Asia/Kolkata" },
      adStats: { totalDelivered: 0, totalFailed: 0, history: [] },
      premium: [],
    };
    writeDB(init);
    return init;
  }
}
function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function backupDB() {
  try {
    const db = readDB();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fname = path.join(BACKUP_DIR, `database-backup-${stamp}.json`);
    fs.writeFileSync(fname, JSON.stringify(db, null, 2));
    console.log("DB backup:", fname);
  } catch (e) {
    console.error("backup error", e?.message || e);
  }
}

// ensure main admin present
(function ensureMainAdmin() {
  const db = readDB();
  const id = String(ALLOWED_ADMIN_ID);
  if (!db.admins.includes(id)) {
    db.admins.push(id);
    writeDB(db);
  }
})();

// ---------------- helpers ----------------
function escapeMd(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function mdCode(text) {
  const safe = String(text).replace(/`/g, "");
  return "`" + safe + "`";
}
function extractLinks(text) {
  const re = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9.-]+\.[a-z]{2,})/gi;
  return [...text.matchAll(re)].map(m => m[0]);
}

// DB wrappers
function saveUserToken(chatId, token) {
  const db = readDB();
  db.tokens[String(chatId)] = token;
  writeDB(db);
}
function getUserToken(chatId) {
  const db = readDB();
  return db.tokens[String(chatId)];
}
function saveLastActive(chatId) {
  const db = readDB();
  db.lastActive[String(chatId)] = Date.now();
  writeDB(db);
}
function addAdmin(chatId) {
  const db = readDB();
  const id = String(chatId);
  db.admins = db.admins || [];
  if (!db.admins.includes(id)) {
    db.admins.push(id);
    writeDB(db);
  }
}
function removeAdmin(chatId) {
  const db = readDB();
  const id = String(chatId);
  db.admins = (db.admins || []).filter(x => x !== id);
  writeDB(db);
}
function isAdmin(chatId) {
  const db = readDB();
  return (db.admins || []).includes(String(chatId));
}
function getAllUsers() {
  const db = readDB();
  return Object.keys(db.lastActive || {});
}
function setAdsMessage(text) {
  const db = readDB();
  db.adsMessage = text;
  writeDB(db);
}
function setHeaderText(text) {
  const db = readDB();
  db.headerText = text;
  writeDB(db);
}
function setFooterText(text) {
  const db = readDB();
  db.footerText = text;
  writeDB(db);
}
function recordAdStat(type, content, delivered, failed) {
  const db = readDB();
  db.adStats = db.adStats || { totalDelivered: 0, totalFailed: 0, history: [] };
  db.adStats.totalDelivered = (db.adStats.totalDelivered || 0) + delivered;
  db.adStats.totalFailed = (db.adStats.totalFailed || 0) + failed;
  db.adStats.history = db.adStats.history || [];
  db.adStats.history.unshift({ id: Date.now(), type, content, delivered, failed, timestamp: new Date().toISOString() });
  if (db.adStats.history.length > 300) db.adStats.history = db.adStats.history.slice(0, 300);
  writeDB(db);
}

// ---------------- API validation + shorten ----------------
async function validateApiLive(token) {
  if (!token) return false;
  try {
    const testUrl = `https://smallshorturl.myvippanel.shop/api?api=${encodeURIComponent(token)}&url=${encodeURIComponent("https://google.com")}`;
    const res = await axios.get(testUrl, { timeout: 15000 });
    return !!(res.data && (res.data.shortenedUrl || res.data.short || res.data.url));
  } catch (e) {
    return false;
  }
}
async function validateApiForShorten(token) {
  if (!USE_LIVE_API_VALIDATION) {
    return token && token.length >= 8;
  }
  return await validateApiLive(token);
}
async function shortenUrl(token, url) {
  try {
    const apiUrl = `https://smallshorturl.myvippanel.shop/api?api=${encodeURIComponent(token)}&url=${encodeURIComponent(url)}`;
    const res = await axios.get(apiUrl, { timeout: 15000 });
    const short = res.data && (res.data.shortenedUrl || res.data.short || res.data.url) ? (res.data.shortenedUrl || res.data.short || res.data.url) : null;
    return short;
  } catch (e) {
    return null;
  }
}

// Build message format exactly as requested (bold labels, monospace short)
function buildShortenMessage(pairs) {
  // Use Markdown (not V2) for readability: bold labels via ** and monospace via backticks
  // We'll send parse_mode: "Markdown"
  const blocks = pairs.map(p => {
    const orig = escapeMd(p.original);
    const short = mdCode(p.short);
    return `✨✨ Congratulations! Your URL has been successfully shortened! 🚀🔗

**Original URL:** ${orig}
**Shortened URL:** ${short}`;
  });
  return blocks.join("\n\n");
}

// ---------------- batching ----------------
async function sendInBatches(userIds, sendFn, batchSize = BATCH_SIZE, batchDelay = BATCH_DELAY_MS) {
  let delivered = 0, failed = 0;
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    await Promise.all(batch.map(async uid => {
      try {
        await sendFn(uid);
        delivered++;
      } catch (e) {
        failed++;
        console.error("batch send failed", uid, e?.message || e);
      }
    }));
    await new Promise(r => setTimeout(r, batchDelay));
  }
  return { delivered, failed };
}

// ---------------- schedule auto-ads ----------------
let lastAutoRun = null;
function startSchedule() {
  setInterval(async () => {
    try {
      const db = readDB();
      if (!db.schedule || !db.schedule.enabled || !db.schedule.time) return;
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const cur = `${hh}:${mm}`;
      if (cur !== db.schedule.time) return;
      const today = now.toDateString();
      if (lastAutoRun === today) return;
      lastAutoRun = today;
      const users = getAllUsers();
      const ad = db.adsMessage || "";
      const { delivered, failed } = await sendInBatches(users, uid => bot.sendMessage(uid, ad, { parse_mode: "Markdown" }));
      recordAdStat("auto-schedule", ad, delivered, failed);
      console.log("Auto ads sent:", { delivered, failed });
    } catch (e) {
      console.error("schedule error", e?.message || e);
    }
  }, SCHEDULE_CHECK_INTERVAL_MS);
}
startSchedule();

// ---------------- auto backups ----------------
setInterval(() => {
  try { backupDB(); } catch (e) { console.error("backup err", e); }
}, AUTO_BACKUP_INTERVAL_MS);

// ----------------- Express Dashboard (Ultra Premium Glass UI) -----------------
app.use(express.urlencoded({ extended: true }));
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => res.send(`${BRAND_NAME} Bot running`));

app.get("/dashboard", (req, res) => {
  const token = req.query.token;
  if (!token || token !== ADMIN_PASSWORD) return res.status(403).send("Forbidden");
  const db = readDB();
  const users = Object.keys(db.lastActive || {}).length;
  const admins = db.admins || [];
  const ads = db.adsMessage || "";
  const header = db.headerText || "";
  const footer = db.footerText || "";
  const schedule = db.schedule || { enabled: false, time: null };
  const stats = db.adStats || { totalDelivered: 0, totalFailed: 0, history: [] };
  const premiumCount = (db.premium || []).length;
  const lastBackup = getLastBackup();

  res.send(`
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${BRAND_NAME} Admin</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
      :root{--bg:#061021;--card:#071029;--muted:#98a6b8;--accent:#7c4dff}
      body{font-family:Inter,system-ui,Arial;background:linear-gradient(180deg,#031026 0%,#051226 100%);color:#eaf4ff;margin:0;padding:18px}
      .wrap{max-width:1100px;margin:0 auto}
      .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
      .logo{display:flex;align-items:center;gap:12px}
      .logo .box{width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,#2b0cff,#7c4dff);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff}
      h1{margin:0;font-size:18px}
      .muted{color:var(--muted);font-size:13px}
      .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}
      .card{background:linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.03);backdrop-filter: blur(6px)}
      .col-4{grid-column:span 4}
      .col-8{grid-column:span 8}
      .title{font-weight:600;margin-bottom:8px}
      textarea,input,button{width:100%;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.03);background:transparent;color:#fff}
      button{background:var(--accent);border:none;padding:10px;border-radius:8px;cursor:pointer}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th,td{padding:8px;border-bottom:1px solid rgba(255,255,255,0.03);font-size:13px;text-align:left}
      @media(max-width:900px){.grid{grid-template-columns:repeat(6,1fr)}.col-4{grid-column:span 6}.col-8{grid-column:span 6}}
    </style>
  </head>
  <body>
  <div class="wrap">
    <div class="top"><div class="logo"><div class="box">PS</div><div><h1>${BRAND_NAME} Admin</h1><div class="muted">Manage ads, users & settings</div></div></div><div class="muted">Users ${users} • Admins ${admins.length}</div></div>
    <div class="grid">
      <div class="card col-4">
        <div class="title">Users</div><div class="muted">Total</div><div style="font-weight:700;font-size:18px">${users}</div>
        <div class="muted" style="margin-top:10px">Last backup: ${escapeHtml(lastBackup || "(none)")}</div>
      </div>
      <div class="card col-4">
        <div class="title">Ads stats</div>
        <div class="muted">Delivered</div><div style="font-weight:700">${stats.totalDelivered||0}</div>
        <div class="muted" style="margin-top:8px">Failed</div><div style="font-weight:700">${stats.totalFailed||0}</div>
      </div>
      <div class="card col-4">
        <div class="title">Premium</div><div class="muted">Count</div><div style="font-weight:700">${premiumCount}</div>
      </div>

      <div class="card col-8">
        <div class="title">Default Ads & Send Now</div>
        <form method="POST" action="/dashboard/setads?token=${ADMIN_PASSWORD}">
          <textarea name="adtext" rows="4" placeholder="Default ad (Markdown)">${escapeHtml(ads)}</textarea>
          <div style="margin-top:8px"><button type="submit">Save Default Ads</button></div>
        </form>

        <hr style="margin:12px 0;border:none"/>

        <form method="POST" action="/dashboard/sendad?token=${ADMIN_PASSWORD}">
          <textarea name="adtext" rows="3" placeholder="Send ad now"></textarea>
          <div style="margin-top:8px"><button type="submit">Send Ad Now</button></div>
        </form>
      </div>

      <div class="card col-4">
        <div class="title">Header / Footer</div>
        <form method="POST" action="/dashboard/sethf?token=${ADMIN_PASSWORD}">
          <input name="header" placeholder="Header text" value="${escapeHtml(header)}"/><div style="height:8px"></div>
          <input name="footer" placeholder="Footer text" value="${escapeHtml(footer)}"/><div style="margin-top:8px"><button type="submit">Save</button></div>
        </form>
      </div>

      <div class="card col-4">
        <div class="title">Schedule</div>
        <form method="POST" action="/dashboard/schedule?token=${ADMIN_PASSWORD}">
          <input type="time" name="schedtime" value="${escapeHtml(schedule.time||"")}"/>
          <div style="margin-top:8px"><button type="submit">Save Schedule</button></div>
        </form>
        <form method="POST" action="/dashboard/disable-schedule?token=${ADMIN_PASSWORD}" style="margin-top:8px">
          <button type="submit">Disable Schedule</button>
        </form>
      </div>

      <div class="card col-4">
        <div class="title">Premium Users</div>
        <form method="POST" action="/dashboard/addpremium?token=${ADMIN_PASSWORD}"><input name="pid" placeholder="chat id"/><div style="margin-top:8px"><button type="submit">Add</button></div></form>
        <form method="POST" action="/dashboard/removepremium?token=${ADMIN_PASSWORD}" style="margin-top:8px"><input name="pid" placeholder="chat id"/><div style="margin-top:8px"><button type="submit">Remove</button></div></form>
      </div>

      <div class="card col-12">
        <div class="title">Recent Ads (latest 10)</div>
        <table><thead><tr><th>Time</th><th>Type</th><th>Delivered</th><th>Failed</th></tr></thead><tbody>
          ${(stats.history||[]).slice(0,10).map(h => `<tr><td>${escapeHtml(h.timestamp)}</td><td>${escapeHtml(h.type)}</td><td>${h.delivered}</td><td>${h.failed}</td></tr>`).join("")}
        </tbody></table>
      </div>

    </div>
    <div style="height:18px"></div>
    <div style="text-align:center;color:#98a6b8;font-size:13px">© ${BRAND_NAME} • Admin Panel</div>
  </div>
  </body>
  </html>
  `);
});

// Dashboard POST handlers
app.post("/dashboard/setads", express.urlencoded({ extended: true }), (req, res) => {
  const token = req.query.token;
  if (!token || token !== ADMIN_PASSWORD) return res.status(403).send("403");
  const text = req.body.adtext || "";
  setAdsMessage(text);
  res.send("Saved");
});
app.post("/dashboard/sendad", express.urlencoded({ extended: true }), async (req, res) => {
  const token = req.query.token;
  if (!token || token !== ADMIN_PASSWORD) return res.status(403).send("403");
  const text = req.body.adtext || "";
  if (!text) return res.send("No text");
  const users = getAllUsers();
  const { delivered, failed } = await sendInBatches(users, uid => bot.sendMessage(uid, text, { parse_mode: "Markdown" }));
  recordAdStat("dashboard-send", text, delivered, failed);
  res.send(`Sent delivered:${delivered} failed:${failed}`);
});
app.post("/dashboard/schedule", express.urlencoded({ extended: true }), (req, res) => {
  const token = req.query.token;
  if (!token || token !== ADMIN_PASSWORD) return res.status(403).send("403");
  const t = (req.body.schedtime || "").trim();
  if (!t) return res.send("Provide time");
  const db = readDB();
  db.schedule = db.schedule || {};
  db.schedule.enabled = true;
  db.schedule.time = t;
  writeDB(db);
  res.send("Schedule set: " + t);
});
app.post("/dashboard/disable-schedule", express.urlencoded({ extended: true }), (req, res) => {
  const token = req.query.token;
  if (!token || token !== ADMIN_PASSWORD) return res.status(403).send("403");
  const db = readDB();
  db.schedule = db.schedule || {};
  db.schedule.enabled = false;
  writeDB(db);
  res.send("Disabled");
});
app.post("/dashboard/sethf", express.urlencoded({ extended: true }), (req, res) => {
  const token = req.query.token;
  if (!token || token !== ADMIN_PASSWORD) return res.status(403).send("403");
  setHeaderText(req.body.header || "");
  setFooterText(req.body.footer || "");
  res.send("Saved");
});
app.post("/dashboard/addpremium", express.urlencoded({ extended: true }), (req, res) => {
  const token = req.query.token;
  if (!token || token !== ADMIN_PASSWORD) return res.status(403).send("403");
  const pid = (req.body.pid || "").trim();
  if (!pid) return res.send("Provide id");
  const db = readDB();
  db.premium = db.premium || [];
  if (!db.premium.includes(pid)) db.premium.push(pid);
  writeDB(db);
  res.send("Added");
});
app.post("/dashboard/removepremium", express.urlencoded({ extended: true }), (req, res) => {
  const token = req.query.token;
  if (!token || token !== ADMIN_PASSWORD) return res.status(403).send("403");
  const pid = (req.body.pid || "").trim();
  if (!pid) return res.send("Provide id");
  const db = readDB();
  db.premium = (db.premium || []).filter(x => x !== pid);
  writeDB(db);
  res.send("Removed");
});

// helper
function escapeHtml(s) { if (!s) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function getLastBackup() {
  try {
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.includes("database-backup-")).sort();
    if (!files.length) return null;
    return files[files.length - 1].replace("database-backup-", "").replace(".json", "");
  } catch (e) { return null; }
}

// start express
app.listen(PORT, () => console.log(`${BRAND_NAME} dashboard running on port ${PORT}`));

// ---------------- TELEGRAM HANDLERS ----------------

// /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from.username || msg.from.first_name || "User";
  saveLastActive(chatId);
  const dashboardLink = "https://smallshorturl.myvippanel.shop/member/tools/api";
  const text = `👋 Hello *${user}*!\n\nSend your *${BRAND_NAME} API Key* from the Dashboard: https://smallshorturl.myvippanel.shop/member/tools/api (use /api YOUR_API)\n\nOnce your API key is set, just send any link — I will shorten it instantly 🔗🚀`;
  bot.sendMessage(chatId, text, { parse_mode: "Markdown" }).catch(console.error);
});

// /api KEY - live validate then save
bot.onText(/\/api (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const token = (match && match[1]) ? match[1].trim() : null;
  saveLastActive(chatId);
  if (!token) {
    bot.sendMessage(chatId, "❌ Provide API: /api YOUR_API_KEY");
    return;
  }
  // live validate
  try {
    const ok = await validateApiLive(token);
    if (!ok) {
      bot.sendMessage(chatId, "❌ Invalid API. Please send your API key.");
      return;
    }
    saveUserToken(chatId, token);
    bot.sendMessage(chatId, "✅ API saved successfully!");
  } catch (e) {
    bot.sendMessage(chatId, "❌ Invalid API. Please send your API key.");
  }
});

// /admin password (strict)
bot.onText(/\/admin (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const pass = (match && match[1]) ? match[1].trim() : "";
  if (Number(chatId) !== Number(ALLOWED_ADMIN_ID)) return; // silent
  if (pass !== ADMIN_PASSWORD) {
    bot.sendMessage(chatId, "❌ Incorrect password.");
    return;
  }
  addAdmin(chatId);
  bot.sendMessage(chatId, "✅ You are now an Admin!", { parse_mode: "Markdown" });
});

// /setautoschedule HH:MM
bot.onText(/\/setautoschedule (\d{1,2}:\d{2})/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const time = match[1].padStart(5, "0");
  const db = readDB();
  db.schedule = db.schedule || {};
  db.schedule.enabled = true;
  db.schedule.time = time;
  writeDB(db);
  bot.sendMessage(chatId, `✅ Auto-ads scheduled daily at ${time}`);
});
bot.onText(/\/disableautoschedule/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const db = readDB();
  db.schedule = db.schedule || {};
  db.schedule.enabled = false;
  writeDB(db);
  bot.sendMessage(chatId, "✅ Auto-ads disabled.");
});

// /setads
bot.onText(/\/setads (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const text = (match && match[1]) ? match[1].trim() : "";
  if (!text) return bot.sendMessage(chatId, "Usage: /setads <text>");
  setAdsMessage(text);
  bot.sendMessage(chatId, "✅ Default ads saved.");
});

// /sendads (one-shot safe)
bot.onText(/\/sendads/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, "❌ Not authorized.");
  bot.sendMessage(chatId, "✏️ Send the advertisement text now (you have 2 minutes).");

  const oneShot = (m) => {
    if (!m.from || m.from.id !== chatId) return;
    if (!m.text) {
      bot.sendMessage(chatId, "No text received. Cancelled.");
      bot.removeListener("message", oneShot);
      return;
    }
    const ad = m.text;
    const users = getAllUsers();
    sendInBatches(users, uid => bot.sendMessage(uid, ad, { parse_mode: "Markdown" }))
      .then(({ delivered, failed }) => {
        recordAdStat("manual-text", ad, delivered, failed);
        bot.sendMessage(chatId, `📢 Ads sent. Delivered: ${delivered}, Failed: ${failed}`);
      }).catch(err => { bot.sendMessage(chatId, "Error sending ads."); console.error(err); });
    bot.removeListener("message", oneShot);
  };

  bot.on("message", oneShot);
  setTimeout(() => bot.removeListener("message", oneShot), 2 * 60 * 1000);
});

// /sendimgads
bot.onText(/\/sendimgads/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, "❌ Not authorized.");
  bot.sendMessage(chatId, "📸 Send the image (photo) you want to broadcast (2 minutes).");

  const oneShot = (m) => {
    if (!m.from || m.from.id !== chatId) return;
    if (!m.photo) {
      bot.sendMessage(chatId, "No photo received. Cancelled.");
      bot.removeListener("message", oneShot);
      return;
    }
    const fileId = m.photo[m.photo.length - 1].file_id;
    const caption = m.caption || "";
    const users = getAllUsers();
    sendInBatches(users, uid => bot.sendPhoto(uid, fileId, { caption, parse_mode: "Markdown" }))
      .then(({ delivered, failed }) => {
        recordAdStat("image", caption, delivered, failed);
        bot.sendMessage(chatId, `📢 Image ads sent. Delivered: ${delivered}, Failed: ${failed}`);
      }).catch(err => { bot.sendMessage(chatId, "Error sending image ads."); console.error(err); });
    bot.removeListener("message", oneShot);
  };

  bot.on("message", oneShot);
  setTimeout(() => bot.removeListener("message", oneShot), 2 * 60 * 1000);
});

// /sendvideoads
bot.onText(/\/sendvideoads/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, "❌ Not authorized.");
  bot.sendMessage(chatId, "🎬 Send the video you want to broadcast (2 minutes).");

  const oneShot = (m) => {
    if (!m.from || m.from.id !== chatId) return;
    if (!m.video) {
      bot.sendMessage(chatId, "No video received. Cancelled.");
      bot.removeListener("message", oneShot);
      return;
    }
    const fileId = m.video.file_id;
    const caption = m.caption || "";
    const users = getAllUsers();
    sendInBatches(users, uid => bot.sendVideo(uid, fileId, { caption, parse_mode: "Markdown" }))
      .then(({ delivered, failed }) => {
        recordAdStat("video", caption, delivered, failed);
        bot.sendMessage(chatId, `📢 Video ads sent. Delivered: ${delivered}, Failed: ${failed}`);
      }).catch(err => { bot.sendMessage(chatId, "Error sending video ads."); console.error(err); });
    bot.removeListener("message", oneShot);
  };

  bot.on("message", oneShot);
  setTimeout(() => bot.removeListener("message", oneShot), 2 * 60 * 1000);
});

// /adsstats
bot.onText(/\/adsstats/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const db = readDB();
  const stats = db.adStats || { totalDelivered: 0, totalFailed: 0, history: [] };
  let out = `📊 Ads Stats\nTotal Delivered: ${stats.totalDelivered}\nTotal Failed: ${stats.totalFailed}\nRecent:\n`;
  (stats.history || []).slice(0, 10).forEach(h => out += `${h.timestamp} | ${h.type} | delivered:${h.delivered} failed:${h.failed}\n`);
  bot.sendMessage(chatId, out);
});

// Premium management
bot.onText(/\/premiumadd (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const id = (match && match[1]) ? String(match[1].trim()) : null;
  if (!id) return bot.sendMessage(chatId, "Usage: /premiumadd <chatId>");
  const db = readDB();
  db.premium = db.premium || [];
  if (!db.premium.includes(id)) db.premium.push(id);
  writeDB(db);
  bot.sendMessage(chatId, `✅ Added ${id} to premium list.`);
});
bot.onText(/\/premiumremove (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const id = (match && match[1]) ? String(match[1].trim()) : null;
  if (!id) return bot.sendMessage(chatId, "Usage: /premiumremove <chatId>");
  const db = readDB();
  db.premium = (db.premium || []).filter(x => x !== id);
  writeDB(db);
  bot.sendMessage(chatId, `✅ Removed ${id} from premium list.`);
});
bot.onText(/\/premiumlist/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const db = readDB();
  bot.sendMessage(chatId, `Premium users:\n${(db.premium || []).join("\n") || "(none)"}`);
});

// header/footer/status/admin commands
bot.onText(/\/setheader (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const txt = (match && match[1]) ? match[1].trim() : "";
  if (!txt) return bot.sendMessage(chatId, "Usage: /setheader <text>");
  setHeaderText(txt);
  bot.sendMessage(chatId, "✅ Header updated.");
});
bot.onText(/\/setfooter (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const txt = (match && match[1]) ? match[1].trim() : "";
  if (!txt) return bot.sendMessage(chatId, "Usage: /setfooter <text>");
  setFooterText(txt);
  bot.sendMessage(chatId, "✅ Footer updated.");
});
bot.onText(/\/toggleheader/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  headerFooterEnabled = !headerFooterEnabled;
  bot.sendMessage(chatId, `Header/Footer are now ${headerFooterEnabled ? "ENABLED" : "DISABLED"}.`);
});
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const db = readDB();
  const usersCount = Object.keys(db.lastActive || {}).length;
  const adminsCount = (db.admins || []).length;
  const schedule = db.schedule || { enabled: false };
  bot.sendMessage(chatId, `📊 Status\nUsers: ${usersCount}\nAdmins: ${adminsCount}\nSchedule: ${schedule.enabled ? "ON " + schedule.time : "OFF"}`);
});
bot.onText(/\/listadmins/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const db = readDB();
  bot.sendMessage(chatId, `Admins:\n${(db.admins || []).join("\n") || "(none)"}`);
});
bot.onText(/\/removeadmin (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const id = (match && match[1]) ? String(match[1].trim()) : null;
  if (!id) return bot.sendMessage(chatId, "Usage: /removeadmin <chatId>");
  if (Number(id) === Number(ALLOWED_ADMIN_ID)) return bot.sendMessage(chatId, "❌ Cannot remove main admin.");
  removeAdmin(id);
  bot.sendMessage(chatId, `✅ Admin removed (if existed).`);
});

// ---------------- message handler: shorten links ----------------
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  if (!msg.text && !msg.caption) return;
  const text = msg.text || msg.caption;

  // ignore handled commands but update lastActive
  if (/^\/(start|api|admin|sendads|sendimgads|sendvideoads|setads|setheader|setfooter|status|premiumadd|premiumremove|premiumlist|adsstats|setautoschedule|disableautoschedule|listadmins|removeadmin)/i.test(text.trim())) {
    if (!/^\/(sendads|sendimgads|sendvideoads)/i.test(text.trim())) saveLastActive(chatId);
    return;
  }

  saveLastActive(chatId);

  const links = extractLinks(text);
  if (!links || links.length === 0) return;

  // premium lock
  const db = readDB();
  if (db.premium && db.premium.length > 0 && !db.premium.includes(String(chatId))) {
    return bot.sendMessage(chatId, "❌ You are not allowed to use this feature.");
  }

  const token = getUserToken(chatId);
  if (!token) {
    return bot.sendMessage(chatId, '❌ Please set your *PikaShort API Key* first.\nUse: /api YOUR_API_KEY', { parse_mode: "Markdown" });
  }
  const ok = await validateApiForShorten(token);
  if (!ok) return bot.sendMessage(chatId, "❌ Invalid API. Please send your API key.");

  // shorten links
  const pairs = [];
  for (const url of links) {
    const short = await shortenUrl(token, url);
    if (short) pairs.push({ original: url, short });
  }
  if (pairs.length === 0) {
    return bot.sendMessage(chatId, "⚠️ Could not shorten any of the links. Please check your API key or try again later.");
  }

  // final message (Markdown)
  const out = buildShortenMessage(pairs);
  try {
    await bot.sendMessage(chatId, out, { parse_mode: "Markdown" });
  } catch (e) {
    // fallback plain
    const fallback = pairs.map(p => `Original: ${p.original}\nShort: ${p.short}`).join("\n\n");
    await bot.sendMessage(chatId, fallback);
  }
});

// --------------- inactive checker ----------------
setInterval(() => {
  try {
    const db = readDB();
    const now = Date.now();
    const limit = INACTIVE_DAYS * 24 * 60 * 60 * 1000;
    for (const uid of Object.keys(db.lastActive || {})) {
      try {
        if (now - db.lastActive[uid] >= limit) {
          bot.sendMessage(uid, inactiveMessage).catch(() => {});
          db.lastActive[uid] = now;
        }
      } catch (e) { console.error("inactive send error", e); }
    }
    writeDB(db);
  } catch (e) { console.error("inactive top error", e); }
}, INACTIVE_CHECK_INTERVAL_HOURS * 60 * 60 * 1000);

// graceful shutdown
process.on("SIGINT", () => { try { backupDB(); } catch {} process.exit(); });
process.on("SIGTERM", () => { try { backupDB(); } catch {} process.exit(); });

console.log("PikaShort Bot V16a started (Dashboard token: afiya1310).");