const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");

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

function defaultDb() {
  const now = new Date().toISOString();
  return {
    version: 1,
    activity: {
      name: "25人副本报名",
      instanceName: "",
      type: "普通活动",
      startTime: "",
      endTime: "",
      status: "open",
      counts: {
        tank: 4,
        healer: 5,
        boss: 0,
        dps: 16
      },
      updatedAt: now,
      updatedBy: "system"
    },
    signups: {},
    audit: [
      {
        id: crypto.randomUUID(),
        at: now,
        actor: "system",
        action: "init",
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

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(DB_PATH, "utf8");
  return JSON.parse(raw);
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

function sanitizeQq(value) {
  const qq = String(value || "").trim();
  if (!/^\d{5,12}$/.test(qq)) {
    return "";
  }
  return qq;
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

function normalizeActivity(body, currentActivity) {
  return {
    name: sanitizeText(body.name || currentActivity.name, 40) || "25人副本报名",
    instanceName: sanitizeText(body.instanceName, 60),
    type: sanitizeText(body.type || "普通活动", 40),
    startTime: sanitizeText(body.startTime, 40),
    endTime: sanitizeText(body.endTime, 40),
    status: body.status === "closed" ? "closed" : "open",
    counts: normalizeCounts(body.counts || currentActivity.counts)
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
    throw new Error("请填写报名 ID");
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
    return `QQ ${signup.qq}，${signup.spec}，ID ${signup.signupId}，增益 ${signup.buffStacks}`;
  }
  if (role === "dps") {
    return `QQ ${signup.qq}，${signup.spec}，ID ${signup.signupId}，装分 ${signup.gearScore}`;
  }
  return `QQ ${signup.qq}，ID ${signup.signupId}${signup.note ? `，备注 ${signup.note}` : ""}`;
}

function getSlot(activity, slotId) {
  return buildSlots(activity).find((slot) => slot.id === slotId);
}

function publicState(db, req) {
  return {
    ok: true,
    activity: db.activity,
    slots: buildSlots(db.activity),
    signups: db.signups,
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
      sendJson(res, 200, publicState(db, req));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(req);
      const qq = sanitizeQq(body.qq);
      if (!qq) {
        sendError(res, 400, "请输入 5 到 12 位数字 QQ 号");
        return;
      }
      sendJson(
        res,
        200,
        { ok: true, user: { qq } },
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
      sendJson(res, 200, { ok: true, audit: db.audit.slice(0, 500) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/activity") {
      if (!isAdmin(req)) {
        sendError(res, 401, "需要管理员登录");
        return;
      }
      const body = await readBody(req);
      const db = readDb();
      const before = JSON.parse(JSON.stringify(db.activity));
      const nextActivity = normalizeActivity(body, db.activity);
      nextActivity.updatedAt = new Date().toISOString();
      nextActivity.updatedBy = "admin";

      const nextSlotIds = new Set(buildSlots(nextActivity).map((slot) => slot.id));
      const removedSignups = [];
      for (const slotId of Object.keys(db.signups)) {
        if (!nextSlotIds.has(slotId)) {
          removedSignups.push({ slotId, signup: db.signups[slotId] });
          delete db.signups[slotId];
        }
      }

      db.activity = nextActivity;
      appendAudit(db, {
        actor: "admin",
        action: "activity:update",
        target: "activity",
        before,
        after: nextActivity,
        summary: `更新活动设置：${nextActivity.instanceName || nextActivity.name}`
      });
      for (const removed of removedSignups) {
        appendAudit(db, {
          actor: "admin",
          action: "signup:remove",
          target: removed.slotId,
          before: removed.signup,
          after: null,
          summary: `位置调整后移除 ${removed.slotId} 的报名：${summarizeSignup(removed.slotId.split("-")[0], removed.signup)}`
        });
      }
      writeDb(db);
      sendJson(res, 200, publicState(db, req));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/activity/clear") {
      if (!isAdmin(req)) {
        sendError(res, 401, "需要管理员登录");
        return;
      }
      const body = await readBody(req);
      const db = readDb();
      const before = db.signups;
      db.signups = {};
      appendAudit(db, {
        actor: "admin",
        action: "activity:clear",
        target: "signups",
        before,
        after: {},
        summary: sanitizeText(body.reason, 80) || "活动结束，清空全部报名"
      });
      writeDb(db);
      sendJson(res, 200, publicState(db, req));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/signups") {
      const body = await readBody(req);
      const qq = sanitizeQq(body.qq || parseCookies(req).qqUser);
      if (!qq) {
        sendError(res, 401, "请先输入 QQ 号登录");
        return;
      }

      const db = readDb();
      if (db.activity.status === "closed" && !isAdmin(req)) {
        sendError(res, 403, "当前活动已关闭报名");
        return;
      }

      const slotId = sanitizeText(body.slotId, 30);
      const slot = getSlot(db.activity, slotId);
      if (!slot) {
        sendError(res, 404, "位置不存在");
        return;
      }

      const before = db.signups[slotId] || null;
      if (before && before.qq !== qq && !isAdmin(req)) {
        sendError(res, 409, "这个位置已经被其他群友报名");
        return;
      }

      const normalized = normalizeSignup(body, slot.role, qq);
      const now = new Date().toISOString();
      const next = {
        slotId,
        role: slot.role,
        ...normalized,
        createdAt: before ? before.createdAt : now,
        updatedAt: now
      };

      db.signups[slotId] = next;
      appendAudit(db, {
        actor: qq,
        action: before ? "signup:update" : "signup:create",
        target: slot.label,
        before,
        after: next,
        summary: `${before ? "修改" : "填写"} ${slot.label}：${summarizeSignup(slot.role, next)}`
      });
      writeDb(db);
      sendJson(res, 200, publicState(db, req));
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/signups/")) {
      const slotId = sanitizeText(decodeURIComponent(url.pathname.replace("/api/signups/", "")), 30);
      const body = await readBody(req).catch(() => ({}));
      const qq = sanitizeQq(body.qq || parseCookies(req).qqUser);
      if (!qq && !isAdmin(req)) {
        sendError(res, 401, "请先输入 QQ 号登录");
        return;
      }

      const db = readDb();
      const slot = getSlot(db.activity, slotId);
      if (!slot) {
        sendError(res, 404, "位置不存在");
        return;
      }
      const before = db.signups[slotId];
      if (!before) {
        sendError(res, 404, "这个位置还没有报名");
        return;
      }
      if (before.qq !== qq && !isAdmin(req)) {
        sendError(res, 403, "只能撤销自己的报名");
        return;
      }
      delete db.signups[slotId];
      appendAudit(db, {
        actor: isAdmin(req) ? "admin" : qq,
        action: "signup:delete",
        target: slot.label,
        before,
        after: null,
        summary: `撤销 ${slot.label}：${summarizeSignup(slot.role, before)}`
      });
      writeDb(db);
      sendJson(res, 200, publicState(db, req));
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
