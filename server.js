const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const DEFAULT_DATA_DIR = path.join(__dirname, "data");
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(DEFAULT_DATA_DIR, "db.json");
const DATA_DIR = path.dirname(DB_PATH);
const PUBLIC_DIR = path.join(__dirname, "public");
const DRAFT_TTL_MS = 90 * 1000;

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

const roleLabels = {
  tank: "T",
  healer: "奶",
  boss: "老板",
  dps: "输出"
};

const roleOrder = ["tank", "healer", "boss", "dps"];
const roleOptions = {
  tank: tankSpecs,
  healer: healerSpecs,
  dps: dpsSpecs,
  boss: ["老板"]
};

const adminTokens = new Set();

function newActivity(overrides = {}) {
  const now = new Date().toISOString();
  const id = overrides.id || crypto.randomUUID();
  return {
    id,
    title: sanitizeText(overrides.title || overrides.instanceName || overrides.name || "25人副本报名", 60),
    difficulty: overrides.difficulty === "hero" ? "hero" : "normal",
    type: sanitizeText(overrides.type || "普通活动", 40),
    startTime: sanitizeText(overrides.startTime, 40),
    endTime: sanitizeText(overrides.endTime, 40),
    status: normalizeActivityStatus(overrides.status),
    counts: {
      tank: Number(overrides.counts?.tank ?? 4),
      healer: Number(overrides.counts?.healer ?? 5),
      boss: Number(overrides.counts?.boss ?? 0),
      dps: Number(overrides.counts?.dps ?? 16)
    },
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

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(DB_PATH, "utf8");
  return migrateDb(JSON.parse(raw));
}

function writeDb(db) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpPath = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmpPath, DB_PATH);
}

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
  db.audit = db.audit.slice(0, 1000);
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

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
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

function buildSlots(activity) {
  const slots = [];
  for (const role of roleOrder) {
    const count = activity.counts[role] || 0;
    for (let index = 1; index <= count; index += 1) {
      slots.push({
        id: `${role}-${index}`,
        role,
        roleLabel: roleLabels[role],
        index,
        label: `${roleLabels[role]} ${index}`
      });
    }
  }
  return slots;
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
  if (Object.values(counts).some((count) => count === null)) {
    throw new Error("位置数量必须是 0 到 25 的整数");
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total !== 25) {
    throw new Error("四类位置数量合计必须等于 25");
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
  const signup = {
    qq,
    spec: sanitizeText(body.spec, 30),
    signupId: sanitizeText(body.signupId, 40),
    buffStacks: "",
    gearScore: "",
    note: ""
  };

  if (!roleOptions[role] || !roleOptions[role].includes(signup.spec)) {
    if (role === "boss") {
      signup.spec = "老板";
    } else {
      throw new Error("请选择该位置可用的心法");
    }
  }

  if (!signup.signupId) {
    throw new Error("请填写游戏 ID");
  }

  if (role === "tank" || role === "healer") {
    const stacks = Number(body.buffStacks);
    if (!Number.isInteger(stacks) || stacks < 0 || stacks > 999) {
      throw new Error("增益层数必须是 0 到 999 的整数");
    }
    signup.buffStacks = String(stacks);
  }

  if (role === "dps") {
    const gearScore = Number(body.gearScore);
    if (!Number.isInteger(gearScore) || gearScore < 0 || gearScore > 999999) {
      throw new Error("装分必须是 0 到 999999 的整数");
    }
    signup.gearScore = String(gearScore);
  }

  if (role === "boss") {
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
  db.selectedActivityId = activity.id;
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
    isAdmin: isAdmin(req)
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
    ".ico": "image/x-icon"
  };
  return types[ext] || "application/octet-stream";
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

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      const db = readDb();
      const activityId = url.searchParams.get("activityId") || "";
      if (cleanupExpiredDrafts(db)) {
        writeDb(db);
      }
      sendJson(res, 200, publicState(db, req, activityId));
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
      if (String(body.password || "") !== ADMIN_PASSWORD) {
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
      sendJson(res, 200, { ok: true, audit: db.audit.slice(0, 500) });
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
      db.activities.unshift(activity);
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
      const admin = isAdmin(req);
      if (!admin) {
        sendError(res, 403, "普通用户不能撤销已提交的报名，请联系管理员处理");
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
      delete maps.signups[slotId];
      appendAudit(db, {
        actor: "admin",
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

    sendError(res, 404, "接口不存在");
  } catch (error) {
    sendError(res, 400, error.message || "请求处理失败");
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  serveStatic(req, res);
});

ensureDb();
server.listen(PORT, () => {
  console.log(`QQ raid signup app is running at http://localhost:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log("ADMIN_PASSWORD is not set. Local admin password is admin123.");
  }
});
