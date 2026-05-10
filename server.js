const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const PORT = Number(process.env.PORT || 3001);

// 加载 .env 文件
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    const match = line.match(/^ADMIN_PASSWORD=(.+)$/);
    if (match && !process.env.ADMIN_PASSWORD) {
      process.env.ADMIN_PASSWORD = match[1].trim();
    }
  });
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const DEFAULT_DATA_DIR = path.join(__dirname, "data");
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(DEFAULT_DATA_DIR, "db.json");
const DATA_DIR = path.dirname(DB_PATH);
const LOG_DIR = process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : path.join(DATA_DIR, "logs");
const LOG_FILE = process.env.LOG_FILE ? path.resolve(process.env.LOG_FILE) : path.join(LOG_DIR, "app.log");
const PUBLIC_DIR = path.join(__dirname, "public");
const DRAFT_TTL_MS = 90 * 1000;
const PASSWORD_HASH_ITERATIONS = 210_000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const BOOT_ID = crypto.randomBytes(8).toString("hex");
const SLOW_API_MS = Number(process.env.SLOW_API_MS || 1000);

const tankSpecs = ["明尊", "洗髓", "铁牢", "铁骨"];
const healerSpecs = ["云裳", "补天", "离经", "相知", "灵素"];
const dpsSpecs = [
  "冰心诀",
  "花间游",
  "毒经",
  "莫问",
  "无方",
  "傲血战意",
  "易筋经",
  "焚影圣诀",
  "分山劲",
  "紫霞功",
  "天罗诡道",
  "问水诀",
  "北傲诀",
  "隐龙诀",
  "孤锋诀",
  "周天功",
  "太虚剑意",
  "惊羽诀",
  "笑尘诀",
  "凌海诀",
  "太玄经",
  "山海心诀",
  "幽罗引",
  "输出心法待定"
];

const allSpecs = [...tankSpecs, ...healerSpecs, ...dpsSpecs];

const roleLabels = {
  tank: "T",
  healer: "奶",
  dps: "输出"
};

const roleOrder = ["dps", "tank", "healer"];
const roleOptions = {
  tank: tankSpecs,
  healer: healerSpecs,
  dps: dpsSpecs,
  boss: allSpecs
};

const adminTokens = new Set();

function newActivity(overrides = {}) {
  const now = new Date().toISOString();
  const id = overrides.id || crypto.randomUUID();
  const counts = normalizeStoredCounts(overrides.counts || {});
  return {
    id,
    title: sanitizeText(overrides.title || overrides.instanceName || overrides.name || "25人副本报名", 60),
    difficulty: overrides.difficulty === "hero" ? "hero" : "normal",
    type: sanitizeText(overrides.type || "普通活动", 40),
    startTime: sanitizeText(overrides.startTime, 40),
    endTime: sanitizeText(overrides.endTime, 40),
    status: normalizeActivityStatus(overrides.status),
    counts,
    creator: normalizeCreator(overrides.creator || { name: overrides.updatedBy || "管理员" }),
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    updatedBy: overrides.updatedBy || "system"
  };
}

function defaultDb() {
  const activity = newActivity({
    title: "25人副本报名",
    creator: { name: "system" },
    updatedBy: "system"
  });
  return {
    version: 3,
    selectedActivityId: activity.id,
    activities: [activity],
    signups: {
      [activity.id]: {}
    },
    drafts: {
      [activity.id]: {}
    },
    adminPassword: null,
    settings: defaultSettings(),
    audit: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        actor: "system",
        action: "init",
        activityId: activity.id,
        target: "activity",
        before: null,
        after: null,
        summary: "初始化报名应用"
      }
    ]
  };
}

function hashAdminPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, PASSWORD_HASH_ITERATIONS, 32, "sha256").toString("hex");
  return {
    algorithm: "pbkdf2-sha256",
    iterations: PASSWORD_HASH_ITERATIONS,
    salt,
    hash,
    updatedAt: new Date().toISOString()
  };
}

function verifyPasswordHash(password, record) {
  if (!record || record.algorithm !== "pbkdf2-sha256" || !record.salt || !record.hash) {
    return false;
  }
  const iterations = Number(record.iterations || PASSWORD_HASH_ITERATIONS);
  const expected = Buffer.from(record.hash, "hex");
  const actual = crypto.pbkdf2Sync(password, record.salt, iterations, expected.length, "sha256");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function verifyAdminPassword(db, password) {
  const value = String(password || "");
  if (db.adminPassword) {
    return verifyPasswordHash(value, db.adminPassword);
  }
  return value === ADMIN_PASSWORD;
}

function serializeError(error) {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: error.code
  };
}

function redactForLog(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactForLog);
  }
  const redacted = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|token|cookie|authorization|image/i.test(key)) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = redactForLog(item);
    }
  }
  return redacted;
}

function rotateLogIfNeeded() {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      const oldPath = `${LOG_FILE}.1`;
      try { fs.unlinkSync(oldPath); } catch {}
      fs.renameSync(LOG_FILE, oldPath);
    }
  } catch {
    // 日志轮转失败时仍继续写控制台。
  }
}

function writeLogLine(line) {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    rotateLogIfNeeded();
    fs.appendFileSync(LOG_FILE, `${line}\n`, "utf8");
  } catch {
    // 文件日志不可用时，控制台日志仍会被 Railway 收集。
  }
}

function logEvent(level, event, details = {}) {
  const entry = {
    at: new Date().toISOString(),
    level,
    event,
    pid: process.pid,
    ...redactForLog(details)
  };
  const line = JSON.stringify(entry);
  if (level === "error" || level === "fatal") {
    console.error(line);
  } else {
    console.log(line);
  }
  writeLogLine(line);
}

function logError(event, error, details = {}) {
  logEvent("error", event, {
    ...details,
    error: serializeError(error)
  });
}

function defaultSettings() {
  return {
    brandLogo: "令",
    brandTitle: "团本召集令",
    brandSubtitle: "剑网3 · 副本活动报名",
    bgColor: "#2a211b",
    brandLogoPath: ""
  };
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    writeDb(defaultDb());
  }
}

function isSlotSignupMap(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length === 0 || keys.some((key) => /^(tank|healer|boss|dps)-\d+$/.test(key));
}

function migrateDb(db) {
  // 确保 settings 永远存在
  if (!db.settings) {
    db.settings = defaultSettings();
  }

  if (Array.isArray(db.activities) && db.version >= 3) {
    db.activities = db.activities.map((activity) => newActivity(activity));
    db.signups = db.signups || {};
    db.drafts = db.drafts || {};
    for (const activity of db.activities) {
      db.signups[activity.id] = db.signups[activity.id] || {};
      db.drafts[activity.id] = db.drafts[activity.id] || {};
    }
    db.audit = Array.isArray(db.audit) ? db.audit : [];
    db.selectedActivityId = db.selectedActivityId || db.activities[0]?.id || "";
    db.version = 3;
    return db;
  }

  const legacyActivity = db.activity || {};
  const activity = newActivity({
    ...legacyActivity,
    id: legacyActivity.id || crypto.randomUUID(),
    title: legacyActivity.title || legacyActivity.instanceName || legacyActivity.name || "25人副本报名",
    status: legacyActivity.status,
    creator: legacyActivity.creator || { name: legacyActivity.updatedBy || "管理员" }
  });

  const legacySignups = isSlotSignupMap(db.signups) ? db.signups : {};
  const legacyDrafts = isSlotSignupMap(db.drafts) ? db.drafts : {};

  return {
    version: 3,
    selectedActivityId: activity.id,
    activities: [activity],
    signups: {
      [activity.id]: legacySignups
    },
    drafts: {
      [activity.id]: legacyDrafts
    },
    audit: Array.isArray(db.audit) ? db.audit : []
  };
}

// ─── 内存缓存 + 写入队列 ───
let dbCache = null;
let writeSerial = Promise.resolve();
let dirty = false;
let stateRevision = 1;
const PERSIST_INTERVAL_MS = 30_000;

function bumpStateRevision() {
  stateRevision += 1;
  return stateRevision;
}

function readDb() {
  ensureDb();
  if (dbCache) return dbCache;
  const raw = fs.readFileSync(DB_PATH, "utf8");
  dbCache = migrateDb(JSON.parse(raw));
  return dbCache;
}

function writeDb(db) {
  dbCache = db;
  bumpStateRevision();
  dirty = true;
  // 通过 Promise 链串行化磁盘写入，不阻塞 API 响应
  writeSerial = writeSerial.then(() => {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpPath = `${DB_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), "utf8");
    fs.renameSync(tmpPath, DB_PATH);
    dirty = false;
  }).catch((err) => {
    logError("db_write_failed", err, { dbPath: DB_PATH });
    dirty = true;
  });
}

// 定时持久化：防止写队列积压时进程崩溃丢数据
const persistenceTimer = setInterval(() => {
  if (dirty && dbCache) {
    writeDb(dbCache);
  }
}, PERSIST_INTERVAL_MS);
persistenceTimer.unref?.();

function appendAudit(db, entry) {
  db.audit.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor: entry.actor,
    action: entry.action,
    activityId: entry.activityId || "",
    target: entry.target,
    before: entry.before || null,
    after: entry.after || null,
    summary: entry.summary
  });
  db.audit = db.audit.slice(0, 500);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const [key, ...value] = cookie.split("=");
        return [decodeURIComponent(key), decodeURIComponent(value.join("="))];
      })
  );
}

function isAdmin(req) {
  const cookies = parseCookies(req);
  return Boolean(cookies.adminToken && adminTokens.has(cookies.adminToken));
}

function acceptsGzip(req) {
  return /\bgzip\b/.test(req?.headers?.["accept-encoding"] || "");
}

function isCompressible(headers, body) {
  const contentType = String(headers["Content-Type"] || headers["content-type"] || "");
  return body.length >= 1024 && /json|javascript|text|svg|css|html/i.test(contentType);
}

function sendBody(req, res, status, headers, body) {
  let payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const nextHeaders = { ...headers };

  if (acceptsGzip(req) && isCompressible(nextHeaders, payload)) {
    payload = zlib.gzipSync(payload);
    nextHeaders["Content-Encoding"] = "gzip";
    nextHeaders.Vary = nextHeaders.Vary ? `${nextHeaders.Vary}, Accept-Encoding` : "Accept-Encoding";
  }

  nextHeaders["Content-Length"] = payload.length;
  res.writeHead(status, nextHeaders);
  res.end(payload);
}

function requestHasEtag(req, etag) {
  const value = req.headers["if-none-match"];
  if (!value) {
    return false;
  }
  return value.split(",").map((item) => item.trim()).includes(etag);
}

function sendNotModified(res, extraHeaders = {}) {
  res.writeHead(304, {
    "Cache-Control": "private, no-cache",
    ...extraHeaders
  });
  res.end();
}

function stateEtag(activityId, admin) {
  return `"state-${BOOT_ID}-${stateRevision}-${activityId || "default"}-${admin ? "admin" : "user"}"`;
}

function sendJson(res, status, payload, extraHeaders = {}) {
  sendBody(res._request, res, status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  }, JSON.stringify(payload));
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("请求体过大"));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("JSON 格式不正确"));
      }
    });
    req.on("error", reject);
  });
}

function sanitizeText(value, maxLength = 80) {
  return String(value || "").trim().slice(0, maxLength);
}

function sanitizeDisplayName(value) {
  return sanitizeText(value, 24);
}

function sanitizeQq(value) {
  const qq = String(value || "").trim();
  if (!/^\d{5,12}$/.test(qq)) {
    return "";
  }
  return qq;
}

function normalizeCreator(input = {}) {
  const qq = sanitizeQq(input.qq);
  const name = sanitizeText(input.name || input.displayName || input.label || "", 24);
  return {
    name: name || (qq ? "" : "管理员"),
    qq
  };
}

function creatorLabel(creator = {}) {
  if (creator.name && creator.qq) {
    return `${creator.name}（QQ ${creator.qq}）`;
  }
  if (creator.name) {
    return creator.name;
  }
  if (creator.qq) {
    return `QQ ${creator.qq}`;
  }
  return "管理员";
}

function actorLabel(qq, displayName) {
  const name = sanitizeDisplayName(displayName);
  return name ? `${name}（QQ ${qq}）` : `QQ ${qq}`;
}

function normalizeActivityStatus(status) {
  return status === "ended" || status === "closed" ? "ended" : "active";
}

function toNonNegativeInt(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 25) {
    return null;
  }
  return number;
}

function normalizeStoredCounts(input = {}) {
  const tank = Number(input.tank ?? 4);
  const healer = Number(input.healer ?? 5);
  const boss = Number(input.boss ?? 0);
  let dps = Number(input.dps ?? 16);
  const nonBossTotal = tank + healer + dps;
  const legacyTotal = nonBossTotal + boss;
  if (nonBossTotal !== 25 && legacyTotal === 25) {
    dps += boss;
  }
  return { tank, healer, boss, dps };
}

function buildSlots(activity) {
  const cells = [];
  for (let column = 1; column <= 5; column += 1) {
    for (let row = 1; row <= 5; row += 1) {
      cells.push({ gridColumn: column, gridRow: row });
    }
  }
  const slots = [];
  const used = new Set();
  const counts = normalizeStoredCounts(activity.counts);
  const takeCells = (preferredColumns, count) => {
    const preferred = cells.filter((cell) => preferredColumns.includes(cell.gridColumn));
    const fallback = cells.filter((cell) => !preferredColumns.includes(cell.gridColumn));
    return [...preferred, ...fallback].filter((cell) => !used.has(`${cell.gridColumn}-${cell.gridRow}`)).slice(0, count);
  };
  const addRole = (role, count, preferredColumns) => {
    const selectedCells = takeCells(preferredColumns, count);
    selectedCells.forEach((cell, index) => {
      used.add(`${cell.gridColumn}-${cell.gridRow}`);
      slots.push({
        id: `${role}-${index + 1}`,
        role,
        roleLabel: roleLabels[role],
        index: index + 1,
        label: `${roleLabels[role]} ${index + 1}`,
        gridColumn: cell.gridColumn,
        gridRow: cell.gridRow
      });
    });
  };

  addRole("tank", counts.tank, [4]);
  addRole("healer", counts.healer, [5]);
  addRole("dps", counts.dps, [1, 2, 3]);

  return slots.sort((a, b) => a.gridColumn - b.gridColumn || a.gridRow - b.gridRow);
}

function getActivity(db, activityId) {
  const requested = sanitizeText(activityId, 80);
  return (
    db.activities.find((activity) => activity.id === requested) ||
    db.activities.find((activity) => activity.id === db.selectedActivityId) ||
    db.activities[0]
  );
}

function getActivityMaps(db, activityId) {
  db.signups[activityId] = db.signups[activityId] || {};
  db.drafts[activityId] = db.drafts[activityId] || {};
  return {
    signups: db.signups[activityId],
    drafts: db.drafts[activityId]
  };
}

function cleanupExpiredDrafts(db, activityId) {
  let changed = false;
  const activityIds = activityId ? [activityId] : db.activities.map((activity) => activity.id);
  const now = Date.now();
  for (const id of activityIds) {
    const maps = getActivityMaps(db, id);
    for (const [slotId, draft] of Object.entries(maps.drafts)) {
      const expiresAt = Date.parse(draft.expiresAt || "");
      if (!expiresAt || expiresAt <= now || maps.signups[slotId]) {
        delete maps.drafts[slotId];
        changed = true;
      }
    }
  }
  return changed;
}

function releaseDraft(db, activityId, slotId, qq, admin) {
  const maps = getActivityMaps(db, activityId);
  const draft = maps.drafts[slotId];
  if (!draft) {
    return false;
  }
  if (!admin && draft.qq !== qq) {
    return false;
  }
  delete maps.drafts[slotId];
  return true;
}

function normalizeCounts(input) {
  const counts = {
    tank: toNonNegativeInt(input.tank),
    healer: toNonNegativeInt(input.healer),
    boss: toNonNegativeInt(input.boss),
    dps: toNonNegativeInt(input.dps)
  };
  const invalidKey = Object.keys(counts).find(k => counts[k] === null);
  if (invalidKey) {
    throw new Error(`位置数量必须是 0 到 25 的整数，但收到 ${JSON.stringify(input)}，字段 ${invalidKey}=${JSON.stringify(input[invalidKey])}`);
  }
  const total = counts.tank + counts.healer + counts.dps;
  if (total !== 25) {
    throw new Error("输出、T、奶三类位置合计必须等于 25；老板名额不参与位置合计");
  }
  return counts;
}

function normalizeActivity(body, currentActivity = {}) {
  return {
    ...currentActivity,
    title: sanitizeText(body.title || body.name || currentActivity.title, 60) || "25人副本报名",
    difficulty: body.difficulty === "hero" ? "hero" : "normal",
    type: sanitizeText(body.type || "普通活动", 40),
    startTime: sanitizeText(body.startTime, 40),
    endTime: sanitizeText(body.endTime, 40),
    status: normalizeActivityStatus(body.status),
    counts: normalizeCounts(body.counts || currentActivity.counts || {}),
    creator: normalizeCreator({
      name: body.creatorName ?? currentActivity.creator?.name,
      qq: body.creatorQq ?? currentActivity.creator?.qq
    })
  };
}

function normalizeSignup(body, role, qq) {
  const isBoss = body.isBoss === true || body.isBoss === "true";
  const signup = {
    qq,
    isBoss,
    spec: sanitizeText(body.spec, 30),
    signupId: sanitizeText(body.signupId, 40),
    buffStacks: "",
    gearScore: "",
    note: ""
  };

  const availableSpecs = isBoss ? allSpecs : roleOptions[role];
  if (!availableSpecs || !availableSpecs.includes(signup.spec)) {
    throw new Error("请选择该位置可用的心法");
  }

  if (!signup.signupId) {
    throw new Error("请填写游戏 ID");
  }

  if (!isBoss && (role === "tank" || role === "healer")) {
    const stacks = Number(body.buffStacks);
    if (!Number.isInteger(stacks) || stacks < 0 || stacks > 999) {
      throw new Error("增益层数必须是 0 到 999 的整数");
    }
    signup.buffStacks = String(stacks);
  }

  if (!isBoss && role === "dps") {
    const gearScore = Number(body.gearScore);
    if (!Number.isInteger(gearScore) || gearScore < 0 || gearScore > 999999) {
      throw new Error("装分必须是 0 到 999999 的整数");
    }
    signup.gearScore = String(gearScore);
  }

  if (isBoss) {
    signup.note = sanitizeText(body.note, 80);
  }

  return signup;
}

function summarizeSignup(role, signup) {
  if (!signup) {
    return "空";
  }
  if (role === "tank" || role === "healer") {
    return `QQ ${signup.qq}，${signup.spec}，游戏ID ${signup.signupId}，增益 ${signup.buffStacks}`;
  }
  if (role === "dps") {
    return `QQ ${signup.qq}，${signup.spec}，游戏ID ${signup.signupId}，装分 ${signup.gearScore}`;
  }
  return `QQ ${signup.qq}，游戏ID ${signup.signupId}${signup.note ? `，备注 ${signup.note}` : ""}`;
}

function getSlot(activity, slotId) {
  return buildSlots(activity).find((slot) => slot.id === slotId);
}

function activitySummary(db, activity) {
  const maps = getActivityMaps(db, activity.id);
  const total = buildSlots(activity).length;
  const signed = Object.keys(maps.signups).length;
  return {
    ...activity,
    difficultyLabel: activity.difficulty === "hero" ? "英雄" : "普通",
    statusLabel: activity.status === "ended" ? "结束" : "进行中",
    creatorLabel: creatorLabel(activity.creator),
    signed,
    total
  };
}

function publicState(db, req, activityId) {
  const activity = getActivity(db, activityId);
  const maps = getActivityMaps(db, activity.id);
  return {
    ok: true,
    selectedActivityId: activity.id,
    activities: db.activities.map((item) => activitySummary(db, item)),
    activity: activitySummary(db, activity),
    slots: buildSlots(activity),
    signups: maps.signups,
    drafts: maps.drafts,
    options: {
      roles: roleLabels,
      specs: roleOptions
    },
    isAdmin: isAdmin(req),
    settings: db.settings || defaultSettings()
  };
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
  };
  return types[ext] || "application/octet-stream";
}

function staticEtag(stat) {
  return `"static-${stat.size}-${Math.floor(stat.mtimeMs)}"`;
}

function sendFile(req, res, filePath, cacheControl) {
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const etag = staticEtag(stat);
    const headers = {
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": cacheControl,
      ETag: etag,
      "Last-Modified": stat.mtime.toUTCString()
    };

    if (requestHasEtag(req, etag)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    fs.readFile(filePath, (readError, content) => {
      if (readError) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      sendBody(req, res, 200, headers, content);
    });
  });
}

function serveLogo(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname);
  const safeRelative = requestedPath.replace("/logos/", "");
  const safePath = path.normalize(path.join(DATA_DIR, "logos", safeRelative));

  if (!safePath.startsWith(path.join(DATA_DIR, "logos"))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  sendFile(req, res, safePath, "public, max-age=86400, immutable");
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname);
  const safePath = requestedPath === "/" ? "/index.html" : requestedPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const isHtml = path.extname(filePath).toLowerCase() === ".html";
  sendFile(req, res, filePath, isHtml ? "no-cache" : "public, max-age=0, must-revalidate");
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestId = crypto.randomUUID();
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    if (durationMs >= SLOW_API_MS) {
      logEvent("warn", "slow_api_request", {
        requestId,
        method: req.method,
        path: url.pathname,
        status: res.statusCode,
        durationMs: Math.round(durationMs)
      });
    }
  });

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      const db = readDb();
      sendJson(res, 200, {
        ok: true,
        uptimeSec: Math.round(process.uptime()),
        revision: stateRevision,
        activities: Array.isArray(db.activities) ? db.activities.length : 0,
        selectedActivityId: db.selectedActivityId || "",
        memory: {
          rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
        },
        storage: {
          persistentPathConfigured: Boolean(process.env.DB_PATH),
          logFileConfigured: Boolean(process.env.LOG_FILE)
        },
        node: process.version
      }, {
        "Cache-Control": "no-store"
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      const db = readDb();
      const activityId = url.searchParams.get("activityId") || "";
      if (cleanupExpiredDrafts(db)) {
        writeDb(db);
      }
      const payload = publicState(db, req, activityId);
      const etag = stateEtag(payload.selectedActivityId, isAdmin(req));
      if (requestHasEtag(req, etag)) {
        sendNotModified(res, { ETag: etag });
        return;
      }
      sendJson(res, 200, payload, {
        "Cache-Control": "private, no-cache",
        ETag: etag
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(req);
      const qq = sanitizeQq(body.qq);
      const displayName = sanitizeDisplayName(body.displayName);
      if (!qq) {
        sendError(res, 400, "请输入 5 到 12 位数字 QQ 号");
        return;
      }
      sendJson(
        res,
        200,
        { ok: true, user: { qq, displayName } },
        {
          "Set-Cookie": `qqUser=${encodeURIComponent(qq)}; Path=/; SameSite=Lax; Max-Age=31536000`
        }
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/login") {
      const body = await readBody(req);
      const db = readDb();
      if (!verifyAdminPassword(db, body.password)) {
        sendError(res, 401, "管理员密码不正确");
        return;
      }
      const token = crypto.randomBytes(32).toString("hex");
      adminTokens.add(token);
      sendJson(
        res,
        200,
        { ok: true },
        {
          "Set-Cookie": `adminToken=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800`
        }
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/logout") {
      const cookies = parseCookies(req);
      if (cookies.adminToken) {
        adminTokens.delete(cookies.adminToken);
      }
      sendJson(
        res,
        200,
        { ok: true },
        {
          "Set-Cookie": "adminToken=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
        }
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/audit") {
      if (!isAdmin(req)) {
        sendError(res, 401, "需要管理员登录");
        return;
      }
      const db = readDb();
      if (cleanupExpiredDrafts(db)) {
        writeDb(db);
      }
      sendJson(res, 200, { ok: true, audit: db.audit.slice(0, 200) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/activities") {
      if (!isAdmin(req)) {
        sendError(res, 401, "需要管理员登录");
        return;
      }
      const body = await readBody(req);
      const db = readDb();
      const activity = normalizeActivity(body, newActivity({ creator: { name: "管理员" } }));
      activity.id = crypto.randomUUID();
      activity.createdAt = new Date().toISOString();
      activity.updatedAt = activity.createdAt;
      activity.updatedBy = "admin";
      db.activities.push(activity);
      db.signups[activity.id] = {};
      db.drafts[activity.id] = {};
      db.selectedActivityId = activity.id;
      appendAudit(db, {
        actor: "admin",
        action: "activity:create",
        activityId: activity.id,
        target: activity.title,
        before: null,
        after: activity,
        summary: `创建活动：${activity.title}`
      });
      writeDb(db);
      sendJson(res, 200, publicState(db, req, activity.id));
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/activities/")) {
      if (!isAdmin(req)) {
        sendError(res, 401, "需要管理员登录");
        return;
      }
      const activityId = sanitizeText(decodeURIComponent(url.pathname.replace("/api/activities/", "")), 80);
      const db = readDb();
      const index = db.activities.findIndex((a) => a.id === activityId);
      if (index === -1) {
        sendError(res, 404, "活动不存在");
        return;
      }
      const activity = db.activities[index];
      if (db.activities.length === 1) {
        sendError(res, 400, "不能删除最后一个活动，至少保留一个活动");
        return;
      }
      db.activities.splice(index, 1);
      delete db.signups[activityId];
      delete db.drafts[activityId];
      appendAudit(db, {
        actor: "admin",
        action: "activity:delete",
        activityId,
        target: activity.title,
        before: activity,
        after: null,
        summary: `删除活动：${activity.title}`
      });
      writeDb(db);
      const nextActivity = db.activities[0];
      db.selectedActivityId = nextActivity.id;
      sendJson(res, 200, publicState(db, req, nextActivity.id));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/password") {
      if (!isAdmin(req)) {
        sendError(res, 401, "需要管理员登录");
        return;
      }
      const body = await readBody(req);
      const currentPassword = String(body.currentPassword || "");
      const newPassword = String(body.newPassword || body.password || "").trim();
      const confirmPassword = String(body.confirmPassword || newPassword).trim();
      if (!newPassword || newPassword.length < 6) {
        sendError(res, 400, "新密码长度至少 6 位");
        return;
      }
      if (newPassword !== confirmPassword) {
        sendError(res, 400, "两次输入的新密码不一致");
        return;
      }
      const db = readDb();
      if (!verifyAdminPassword(db, currentPassword)) {
        sendError(res, 403, "当前管理员密码不正确");
        return;
      }

      db.adminPassword = hashAdminPassword(newPassword);
      appendAudit(db, {
        actor: "admin",
        action: "admin:password-update",
        activityId: db.selectedActivityId,
        target: "管理员密码",
        before: null,
        after: { updatedAt: db.adminPassword.updatedAt },
        summary: "更新管理员密码"
      });
      writeDb(db);

      const token = crypto.randomBytes(32).toString("hex");
      adminTokens.clear();
      adminTokens.add(token);
      sendJson(
        res,
        200,
        { ok: true, message: "管理员密码已更新" },
        {
          "Set-Cookie": `adminToken=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800`
        }
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/activity") {
      if (!isAdmin(req)) {
        sendError(res, 401, "需要管理员登录");
        return;
      }
      const body = await readBody(req);
      const db = readDb();
      const activity = getActivity(db, body.activityId);
      if (!activity) {
        sendError(res, 404, "活动不存在");
        return;
      }
      cleanupExpiredDrafts(db, activity.id);
      const before = JSON.parse(JSON.stringify(activity));
      const nextActivity = normalizeActivity(body, activity);
      nextActivity.id = activity.id;
      nextActivity.createdAt = activity.createdAt;
      nextActivity.updatedAt = new Date().toISOString();
      nextActivity.updatedBy = "admin";

      const maps = getActivityMaps(db, activity.id);
      const nextSlotIds = new Set(buildSlots(nextActivity).map((slot) => slot.id));
      const removedSignups = [];
      for (const slotId of Object.keys(maps.signups)) {
        if (!nextSlotIds.has(slotId)) {
          removedSignups.push({ slotId, signup: maps.signups[slotId] });
          delete maps.signups[slotId];
        }
      }
      for (const slotId of Object.keys(maps.drafts)) {
        if (!nextSlotIds.has(slotId)) {
          delete maps.drafts[slotId];
        }
      }

      const index = db.activities.findIndex((item) => item.id === activity.id);
      db.activities[index] = nextActivity;
      db.selectedActivityId = nextActivity.id;
      appendAudit(db, {
        actor: "admin",
        action: "activity:update",
        activityId: nextActivity.id,
        target: nextActivity.title,
        before,
        after: nextActivity,
        summary: `更新活动：${nextActivity.title}`
      });
      for (const removed of removedSignups) {
        appendAudit(db, {
          actor: "admin",
          action: "signup:remove",
          activityId: nextActivity.id,
          target: removed.slotId,
          before: removed.signup,
          after: null,
          summary: `位置调整后移除 ${removed.slotId} 的报名：${summarizeSignup(removed.slotId.split("-")[0], removed.signup)}`
        });
      }
      writeDb(db);
      sendJson(res, 200, publicState(db, req, nextActivity.id));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/activity/clear") {
      if (!isAdmin(req)) {
        sendError(res, 401, "需要管理员登录");
        return;
      }
      const body = await readBody(req);
      const db = readDb();
      const activity = getActivity(db, body.activityId);
      if (!activity) {
        sendError(res, 404, "活动不存在");
        return;
      }
      const maps = getActivityMaps(db, activity.id);
      const before = maps.signups;
      db.signups[activity.id] = {};
      db.drafts[activity.id] = {};
      appendAudit(db, {
        actor: "admin",
        action: "activity:clear",
        activityId: activity.id,
        target: activity.title,
        before,
        after: {},
        summary: sanitizeText(body.reason, 80) || "活动结束，清空全部报名"
      });
      writeDb(db);
      sendJson(res, 200, publicState(db, req, activity.id));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/drafts") {
      const body = await readBody(req);
      const qq = sanitizeQq(body.qq || parseCookies(req).qqUser);
      const displayName = sanitizeDisplayName(body.displayName);
      if (!qq) {
        sendError(res, 401, "请先输入 QQ 号登录");
        return;
      }

      const db = readDb();
      const activity = getActivity(db, body.activityId);
      if (!activity) {
        sendError(res, 404, "活动不存在");
        return;
      }
      cleanupExpiredDrafts(db, activity.id);
      const maps = getActivityMaps(db, activity.id);
      if (activity.status === "ended" && !isAdmin(req)) {
        sendError(res, 403, "当前活动已结束");
        return;
      }

      const slotId = sanitizeText(body.slotId, 30);
      const slot = getSlot(activity, slotId);
      if (!slot) {
        sendError(res, 404, "位置不存在");
        return;
      }
      if (maps.signups[slotId]) {
        sendError(res, 409, "这个位置已经填写完成");
        return;
      }

      const existing = maps.drafts[slotId];
      if (existing && existing.qq !== qq && !isAdmin(req)) {
        sendError(res, 409, `${actorLabel(existing.qq, existing.displayName)}正在填写中`);
        return;
      }

      const now = new Date();
      maps.drafts[slotId] = {
        activityId: activity.id,
        slotId,
        role: slot.role,
        qq,
        displayName,
        startedAt: existing && existing.qq === qq ? existing.startedAt : now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString()
      };
      writeDb(db);
      sendJson(res, 200, publicState(db, req, activity.id));
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/drafts/")) {
      const slotId = sanitizeText(decodeURIComponent(url.pathname.replace("/api/drafts/", "")), 30);
      const body = await readBody(req).catch(() => ({}));
      const qq = sanitizeQq(body.qq || parseCookies(req).qqUser);
      const db = readDb();
      const activity = getActivity(db, body.activityId);
      if (!activity) {
        sendError(res, 404, "活动不存在");
        return;
      }
      cleanupExpiredDrafts(db, activity.id);
      releaseDraft(db, activity.id, slotId, qq, isAdmin(req));
      writeDb(db);
      sendJson(res, 200, publicState(db, req, activity.id));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/signups") {
      const body = await readBody(req);
      const qq = sanitizeQq(body.qq || parseCookies(req).qqUser);
      const admin = isAdmin(req);
      if (!qq) {
        sendError(res, 401, "请先输入 QQ 号登录");
        return;
      }

      const db = readDb();
      const activity = getActivity(db, body.activityId);
      if (!activity) {
        sendError(res, 404, "活动不存在");
        return;
      }
      cleanupExpiredDrafts(db, activity.id);
      const maps = getActivityMaps(db, activity.id);
      if (activity.status === "ended" && !admin) {
        sendError(res, 403, "当前活动已结束");
        return;
      }

      const slotId = sanitizeText(body.slotId, 30);
      const slot = getSlot(activity, slotId);
      if (!slot) {
        sendError(res, 404, "位置不存在");
        return;
      }

      const before = maps.signups[slotId] || null;
      if (before && !admin && before.qq !== qq) {
        sendError(res, 403, "只能修改自己的报名信息");
        return;
      }

      const draft = maps.drafts[slotId];
      if (draft && draft.qq !== qq && !admin) {
        sendError(res, 409, `${actorLabel(draft.qq, draft.displayName)}正在填写中`);
        return;
      }

      const normalized = normalizeSignup(body, slot.role, qq);
      const now = new Date().toISOString();
      const next = {
        activityId: activity.id,
        slotId,
        role: slot.role,
        ...normalized,
        createdAt: before ? before.createdAt : now,
        updatedAt: now
      };

      maps.signups[slotId] = next;
      delete maps.drafts[slotId];
      appendAudit(db, {
        actor: admin ? "admin" : qq,
        action: before ? "signup:update" : "signup:create",
        activityId: activity.id,
        target: slot.label,
        before,
        after: next,
        summary: `${before ? "修改" : "填写"} ${activity.title} / ${slot.label}：${summarizeSignup(slot.role, next)}`
      });
      writeDb(db);
      sendJson(res, 200, publicState(db, req, activity.id));
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/signups/")) {
      const slotId = sanitizeText(decodeURIComponent(url.pathname.replace("/api/signups/", "")), 30);
      const body = await readBody(req).catch(() => ({}));
      const qq = sanitizeQq(body.qq || parseCookies(req).qqUser);
      const admin = isAdmin(req);
      if (!qq) {
        sendError(res, 401, "请先输入 QQ 号登录");
        return;
      }

      const db = readDb();
      const activity = getActivity(db, body.activityId);
      if (!activity) {
        sendError(res, 404, "活动不存在");
        return;
      }
      cleanupExpiredDrafts(db, activity.id);
      const maps = getActivityMaps(db, activity.id);
      const slot = getSlot(activity, slotId);
      if (!slot) {
        sendError(res, 404, "位置不存在");
        return;
      }
      const before = maps.signups[slotId];
      if (!before) {
        sendError(res, 404, "这个位置还没有报名");
        return;
      }
      if (!admin && before.qq !== qq) {
        sendError(res, 403, "只能撤销自己的报名");
        return;
      }
      delete maps.signups[slotId];
      appendAudit(db, {
        actor: admin ? "admin" : qq,
        action: "signup:delete",
        activityId: activity.id,
        target: slot.label,
        before,
        after: null,
        summary: `撤销 ${activity.title} / ${slot.label}：${summarizeSignup(slot.role, before)}`
      });
      writeDb(db);
      sendJson(res, 200, publicState(db, req, activity.id));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/settings") {
      if (!isAdmin(req)) {
        sendError(res, 401, "需要管理员登录");
        return;
      }
      const body = await readBody(req);
      const db = readDb();
      const current = db.settings || defaultSettings();
      const next = {
        ...current,
        brandLogo: sanitizeText(body.brandLogo, 8) || current.brandLogo,
        brandTitle: sanitizeText(body.brandTitle, 40) || current.brandTitle,
        brandSubtitle: sanitizeText(body.brandSubtitle, 80) || current.brandSubtitle,
        bgColor: /^#[0-9a-fA-F]{3,6}$/.test(String(body.bgColor || "")) ? body.bgColor : current.bgColor
      };
      db.settings = next;
      appendAudit(db, {
        actor: "admin",
        action: "settings:update",
        activityId: db.selectedActivityId,
        target: "UI 设置",
        before: current,
        after: next,
        summary: "更新自定义 UI 设置"
      });
      writeDb(db);
      sendJson(res, 200, { ok: true, settings: next });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/settings/logo") {
      if (!isAdmin(req)) {
        sendError(res, 401, "需要管理员登录");
        return;
      }
      const body = await readBody(req);
      const imageData = String(body.image || "");
      const db = readDb();
      db.settings = db.settings || defaultSettings();

      // 空 image = 移除 logo
      if (!imageData) {
        const previousPath = db.settings.brandLogoPath;
        if (previousPath) {
          const oldFilePath = path.join(DATA_DIR, "logos", path.basename(previousPath));
          try { fs.unlinkSync(oldFilePath); } catch {}
        }
        db.settings.brandLogoPath = "";
        appendAudit(db, {
          actor: "admin",
          action: "settings:logo-remove",
          activityId: db.selectedActivityId,
          target: "Logo 图片",
          before: { path: previousPath },
          after: null,
          summary: "移除自定义 Logo 图片"
        });
        writeDb(db);
        sendJson(res, 200, { ok: true, logoPath: "" });
        return;
      }

      const match = imageData.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
      if (!match) {
        sendError(res, 400, "图片格式不支持，仅支持 png/jpg/gif/webp");
        return;
      }
      const ext = match[1] === "jpeg" ? "jpg" : match[1];
      const base64 = match[2];
      const buffer = Buffer.from(base64, "base64");
      if (buffer.length > 2 * 1024 * 1024) {
        sendError(res, 400, "图片大小不能超过 2MB");
        return;
      }
      const logosDir = path.join(DATA_DIR, "logos");
      if (!fs.existsSync(logosDir)) {
        fs.mkdirSync(logosDir, { recursive: true });
      }
      const filename = `${crypto.randomUUID()}.${ext}`;
      const filePath = path.join(logosDir, filename);
      fs.writeFileSync(filePath, buffer);
      const previousPath = db.settings.brandLogoPath;
      db.settings.brandLogoPath = `/logos/${filename}`;
      if (previousPath) {
        const oldFilePath = path.join(DATA_DIR, "logos", path.basename(previousPath));
        try { fs.unlinkSync(oldFilePath); } catch {}
      }
      appendAudit(db, {
        actor: "admin",
        action: "settings:logo",
        activityId: db.selectedActivityId,
        target: "Logo 图片",
        before: { path: previousPath },
        after: { path: db.settings.brandLogoPath },
        summary: "上传自定义 Logo 图片"
      });
      writeDb(db);
      sendJson(res, 200, { ok: true, logoPath: db.settings.brandLogoPath });
      return;
    }

    sendError(res, 404, "接口不存在");
  } catch (error) {
    logError("api_request_failed", error, {
      requestId,
      method: req.method,
      path: url.pathname
    });
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendError(res, 400, error.message || "请求处理失败");
  }
}

const server = http.createServer((req, res) => {
  res._request = req;
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch((error) => {
      logError("api_unhandled_rejection", error, {
        method: req.method,
        path: req.url
      });
      if (!res.headersSent) {
        sendError(res, 500, "服务器内部错误");
      } else {
        res.destroy();
      }
    });
    return;
  }
  if (req.url.startsWith("/logos/")) {
    serveLogo(req, res);
    return;
  }
  serveStatic(req, res);
});

server.on("clientError", (error, socket) => {
  logError("http_client_error", error);
  if (socket.writable) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  }
});

server.on("error", (error) => {
  logError("server_error", error, { port: PORT });
});

let shuttingDown = false;

function waitForWrites(timeoutMs = 5000) {
  return Promise.race([
    writeSerial,
    new Promise((resolve) => setTimeout(resolve, timeoutMs))
  ]);
}

function shutdown(reason, error) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  clearInterval(persistenceTimer);
  if (error) {
    logEvent("fatal", "process_shutdown", { reason, error: serializeError(error) });
  } else {
    logEvent("info", "process_shutdown", { reason });
  }

  const forceExitTimer = setTimeout(() => {
    logEvent("fatal", "process_shutdown_forced", { reason });
    process.exit(error ? 1 : 0);
  }, 10_000);
  forceExitTimer.unref?.();

  server.close(async () => {
    await waitForWrites();
    logEvent("info", "process_shutdown_complete", { reason });
    process.exit(error ? 1 : 0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (error) => shutdown("uncaughtException", error));
process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  shutdown("unhandledRejection", error);
});

ensureDb();
server.listen(PORT, () => {
  logEvent("info", "server_started", {
    port: PORT,
    dbPath: DB_PATH,
    logFile: LOG_FILE,
    bootId: BOOT_ID,
    slowApiMs: SLOW_API_MS
  });
  if (!process.env.ADMIN_PASSWORD) {
    logEvent("warn", "default_admin_password_enabled", {
      message: "ADMIN_PASSWORD is not set. Local admin password is admin123."
    });
  }
});
