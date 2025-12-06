
// V16a FIX — Part 1 of 4
// Paste Part 1 first

// bot.js - V16a FIX (PikaShort) - Full production-ready
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

// ensure folders exist
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
    if (!fs.existsSync(DB_PATH)) {
      // create initial DB if missing
      const init = {
        tokens: {},
        lastActive: {},
        admins: [String(ALLOWED_ADMIN_ID)],
        adsMessage: `🔥 *${BRAND_NAME} SPECIAL!*  \nEarn More With SmallshortURL!  \nVisit 👉 https://smallshorturl.myvippanel.shop`,
        headerText: "not available now",
        footerText: "not available now",
        schedule: { enabled: false, time: null, timezone: "Asia/Kolkata" },
        adStats: { totalDelivered: 0, totalFailed: 0, history: [] },
        premium: []
      };
      fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2));
      return init;
    }
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
    console.error("readDB error:", e && e.message ? e.message : e);
    // fallback minimal structure
    return {
      tokens: {},
      lastActive: {},
      admins: [String(ALLOWED_ADMIN_ID)],
      adsMessage: `🔥 *${BRAND_NAME} SPECIAL!*  \nEarn More With SmallshortURL!  \nVisit 👉 https://smallshorturl.myvippanel.shop`,
      headerText: "not available now",
      footerText: "not available now",
      schedule: { enabled: false, time: null, timezone: "Asia/Kolkata" },
      adStats: { totalDelivered: 0, totalFailed: 0, history: [] },
      premium: []
    };
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
    console.error("backup error", e && e.message ? e.message : e);
  }
}

// ensure main admin present (idempotent)
(function ensureMainAdmin() {
  try {
    const db = readDB();
    const id = String(ALLOWED_ADMIN_ID);
    if (!db.admins.includes(id)) {
      db.admins.push(id);
      writeDB(db);
    }
  } catch (e) {
    console.error("ensureMainAdmin error", e && e.message ? e.message : e);
  }
})();
