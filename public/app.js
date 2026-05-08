const roleOrder = ["tank", "healer", "boss", "dps"];
const roleLabels = {
  tank: "T",
  healer: "奶",
  boss: "老板",
  dps: "输出"
};

let appState = null;
let currentUser = loadUser();
let selectedSlot = null;
let draftHeartbeat = null;
let refreshTimer = null;
let auditLoadedOnce = false;

const elements = {
  activitySubtitle: document.querySelector("#activitySubtitle"),
  userBadge: document.querySelector("#userBadge"),
  logoutBtn: document.querySelector("#logoutBtn"),
  adminToggleBtn: document.querySelector("#adminToggleBtn"),
  statusPill: document.querySelector("#statusPill"),
  timeRange: document.querySelector("#timeRange"),
  activityTitle: document.querySelector("#activityTitle"),
  activityMeta: document.querySelector("#activityMeta"),
  summaryStats: document.querySelector("#summaryStats"),
  loginPanel: document.querySelector("#loginPanel"),
  loginForm: document.querySelector("#loginForm"),
  qqInput: document.querySelector("#qqInput"),
  displayNameInput: document.querySelector("#displayNameInput"),
  adminPanel: document.querySelector("#adminPanel"),
  activityForm: document.querySelector("#activityForm"),
  activityNameInput: document.querySelector("#activityNameInput"),
  instanceInput: document.querySelector("#instanceInput"),
  typeInput: document.querySelector("#typeInput"),
  startTimeInput: document.querySelector("#startTimeInput"),
  endTimeInput: document.querySelector("#endTimeInput"),
  statusInput: document.querySelector("#statusInput"),
  tankCountInput: document.querySelector("#tankCountInput"),
  healerCountInput: document.querySelector("#healerCountInput"),
  bossCountInput: document.querySelector("#bossCountInput"),
  dpsCountInput: document.querySelector("#dpsCountInput"),
  countTotal: document.querySelector("#countTotal"),
  refreshAuditBtn: document.querySelector("#refreshAuditBtn"),
  clearSignupsBtn: document.querySelector("#clearSignupsBtn"),
  adminLogoutBtn: document.querySelector("#adminLogoutBtn"),
  auditList: document.querySelector("#auditList"),
  boardHint: document.querySelector("#boardHint"),
  refreshBtn: document.querySelector("#refreshBtn"),
  board: document.querySelector("#board"),
  signupDialog: document.querySelector("#signupDialog"),
  signupForm: document.querySelector("#signupForm"),
  dialogRole: document.querySelector("#dialogRole"),
  dialogTitle: document.querySelector("#dialogTitle"),
  closeDialogBtn: document.querySelector("#closeDialogBtn"),
  slotIdInput: document.querySelector("#slotIdInput"),
  dialogQqInput: document.querySelector("#dialogQqInput"),
  specField: document.querySelector("#specField"),
  specInput: document.querySelector("#specInput"),
  signupIdInput: document.querySelector("#signupIdInput"),
  buffField: document.querySelector("#buffField"),
  buffStacksInput: document.querySelector("#buffStacksInput"),
  gearField: document.querySelector("#gearField"),
  gearScoreInput: document.querySelector("#gearScoreInput"),
  noteField: document.querySelector("#noteField"),
  noteInput: document.querySelector("#noteInput"),
  deleteSignupBtn: document.querySelector("#deleteSignupBtn"),
  adminDialog: document.querySelector("#adminDialog"),
  adminLoginForm: document.querySelector("#adminLoginForm"),
  adminPasswordInput: document.querySelector("#adminPasswordInput"),
  closeAdminDialogBtn: document.querySelector("#closeAdminDialogBtn"),
  toast: document.querySelector("#toast")
};

function loadUser() {
  try {
    return JSON.parse(localStorage.getItem("qqSignupUser")) || null;
  } catch {
    return null;
  }
}

function saveUser(user) {
  currentUser = user;
  if (user) {
    localStorage.setItem("qqSignupUser", JSON.stringify(user));
  } else {
    localStorage.removeItem("qqSignupUser");
  }
  renderUser();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    credentials: "same-origin",
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "请求失败");
  }
  return payload;
}

function showToast(message, type = "info") {
  elements.toast.textContent = message;
  const inferredType =
    type !== "info"
      ? type
      : /失败|错误|不能|需要|请先|关闭|已报名|不存在|只可|冲突|不正确/.test(message)
        ? "error"
        : /成功|已保存|已刷新|已登录|已退出|已清空|已登出|已撤销/.test(message)
          ? "success"
          : "info";
  elements.toast.dataset.type = inferredType;
  elements.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 3600);
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function toLocalInputValue(value) {
  if (!value) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return value.slice(0, 16);
  }
  return value;
}

function countRole(role) {
  return appState.slots.filter((slot) => slot.role === role).length;
}

function signedCount(role) {
  return appState.slots.filter((slot) => slot.role === role && appState.signups[slot.id]).length;
}

function draftingCount(role) {
  return appState.slots.filter((slot) => slot.role === role && appState.drafts?.[slot.id]).length;
}

function displayActor(actor) {
  if (!actor) {
    return "";
  }
  return actor.displayName ? `${actor.displayName}（QQ ${actor.qq}）` : `QQ ${actor.qq}`;
}

function isOwnDraft(draft) {
  return Boolean(currentUser && draft && draft.qq === currentUser.qq);
}

function renderUser() {
  if (currentUser) {
    elements.userBadge.textContent = currentUser.displayName
      ? `${currentUser.displayName} · QQ ${currentUser.qq}`
      : `QQ ${currentUser.qq}`;
    elements.userBadge.hidden = false;
    elements.logoutBtn.hidden = false;
    elements.loginPanel.hidden = true;
  } else {
    elements.userBadge.hidden = true;
    elements.logoutBtn.hidden = true;
    elements.loginPanel.hidden = false;
  }

  if (appState) {
    elements.boardHint.textContent = currentUser
      ? "选择空位填写报名信息；已提交的自己报名可以继续修改。"
      : "登录后选择空位填写报名信息。";
  }
}

function renderSummary() {
  const activity = appState.activity;
  const title = activity.instanceName || activity.name || "25人副本报名";
  const timeText =
    activity.startTime || activity.endTime
      ? `${formatDateTime(activity.startTime) || "开始待定"} - ${formatDateTime(activity.endTime) || "结束待定"}`
      : "时间待定";

  elements.activitySubtitle.textContent = `${activity.type || "普通活动"} · ${timeText}`;
  elements.activityTitle.textContent = title;
  elements.activityMeta.textContent = `${activity.name || "25人副本报名"} · ${activity.type || "普通活动"}`;
  elements.timeRange.textContent = timeText;
  elements.statusPill.textContent = activity.status === "closed" ? "封榜" : "开榜";
  elements.statusPill.className = `status-pill ${activity.status === "closed" ? "closed" : "open"}`;

  elements.summaryStats.innerHTML = roleOrder
    .map((role) => {
      const signed = signedCount(role);
      const drafting = draftingCount(role);
      const total = countRole(role);
      return `
        <div class="stat ${role}">
          <strong>${signed}/${total}</strong>
          <span>${roleLabels[role]} 已定 · ${drafting} 填写中</span>
        </div>
      `;
    })
    .join("");
}

function renderAdminPanel(options = {}) {
  elements.adminPanel.hidden = !appState.isAdmin;
  if (!appState.isAdmin) {
    auditLoadedOnce = false;
    return;
  }

  const shouldPreserveForm =
    options.preserveAdminForm || elements.activityForm.contains(document.activeElement);
  if (!shouldPreserveForm) {
    const activity = appState.activity;
    elements.activityNameInput.value = activity.name || "";
    elements.instanceInput.value = activity.instanceName || "";
    elements.typeInput.value = activity.type || "";
    elements.startTimeInput.value = toLocalInputValue(activity.startTime);
    elements.endTimeInput.value = toLocalInputValue(activity.endTime);
    elements.statusInput.value = activity.status || "open";
    elements.tankCountInput.value = activity.counts.tank;
    elements.healerCountInput.value = activity.counts.healer;
    elements.bossCountInput.value = activity.counts.boss;
    elements.dpsCountInput.value = activity.counts.dps;
    updateCountTotal();
  }

  if (!options.skipAudit && !auditLoadedOnce) {
    auditLoadedOnce = true;
    loadAudit();
  }
}

function renderBoard() {
  const grouped = Object.fromEntries(roleOrder.map((role) => [role, []]));
  for (const slot of appState.slots) {
    grouped[slot.role].push(slot);
  }

  elements.board.innerHTML = roleOrder
    .filter((role) => grouped[role].length > 0)
    .map((role) => {
      const total = grouped[role].length;
      const signed = grouped[role].filter((slot) => appState.signups[slot.id]).length;
      const drafting = grouped[role].filter((slot) => appState.drafts?.[slot.id]).length;
      const cards = grouped[role].map(renderSlot).join("");
      return `
        <div class="role-group">
          <div class="role-head ${role}">
            <h3>${roleLabels[role]}</h3>
            <span>${signed}/${total} 已定 · ${drafting} 填写中</span>
          </div>
          <div class="slot-grid">${cards}</div>
        </div>
      `;
    })
    .join("");

  for (const button of elements.board.querySelectorAll(".slot-card")) {
    button.addEventListener("click", () => openSignupDialog(button.dataset.slotId));
  }
}

function renderSlot(slot) {
  const signup = appState.signups[slot.id];
  const draft = appState.drafts?.[slot.id];
  const owned = currentUser && signup && signup.qq === currentUser.qq;
  const occupied = Boolean(signup);
  const drafting = Boolean(!signup && draft);
  const ownDraft = isOwnDraft(draft);
  const status = occupied ? (owned ? "我的报名" : "已定") : drafting ? "填写中" : "空位";
  const action = getSlotAction(signup, draft, owned, ownDraft);
  const body = signup
    ? renderSignupBody(slot.role, signup)
    : drafting
      ? renderDraftBody(draft, ownDraft)
      : `<span class="slot-empty">虚席以待</span>`;

  return `
    <button class="slot-card ${occupied ? "occupied" : ""} ${owned ? "owned" : ""} ${drafting ? "drafting" : ""} ${ownDraft ? "own-draft" : ""}" type="button" data-slot-id="${slot.id}">
      <span class="slot-top">
        <span class="slot-tag ${slot.role}">${slot.label}</span>
        <span class="slot-status">${status}</span>
      </span>
      <span class="slot-body">${body}</span>
      <span class="slot-action">${action}</span>
    </button>
  `;
}

function getSlotAction(signup, draft, owned, ownDraft) {
  if (!currentUser) {
    return "登录后可报名";
  }
  if (signup) {
    if (appState.isAdmin) {
      return "管理员调整";
    }
    return owned ? "修改报名" : "查看信息";
  }
  if (draft && !ownDraft) {
    return `${escapeHtml(displayActor(draft))}正在填写中`;
  }
  return ownDraft ? "继续填写" : "填写报名";
}

function renderDraftBody(draft, ownDraft) {
  return `
    <span class="slot-id">${ownDraft ? "你正在填写" : "填写中"}</span>
    <span class="slot-detail">${escapeHtml(displayActor(draft))}正在填写中，稍后自动释放。</span>
  `;
}

function renderSignupBody(role, signup) {
  const meta = [];
  meta.push(`<span class="signup-chip">QQ ${escapeHtml(signup.qq)}</span>`);
  if (role !== "boss" && signup.spec) {
    meta.push(`<span class="signup-chip spec">${escapeHtml(signup.spec)}</span>`);
  }
  if (role === "tank" || role === "healer") {
    meta.push(`<span class="signup-chip">增益 ${escapeHtml(signup.buffStacks)}</span>`);
  }
  if (role === "dps") {
    meta.push(`<span class="signup-chip">装分 ${escapeHtml(signup.gearScore)}</span>`);
  }
  if (role === "boss" && signup.note) {
    meta.push(`<span class="signup-chip note">${escapeHtml(signup.note)}</span>`);
  }

  return `
    <span class="signup-summary">
      <span class="signup-label">游戏 ID</span>
      <span class="slot-id">${escapeHtml(signup.signupId)}</span>
      <span class="slot-detail">${meta.join("")}</span>
    </span>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderAll(options = {}) {
  renderUser();
  renderSummary();
  renderAdminPanel(options);
  renderBoard();
}

async function loadState(options = {}) {
  appState = await api("/api/state");
  renderAll(options);
}

function updateCountTotal() {
  const values = [
    elements.tankCountInput,
    elements.healerCountInput,
    elements.bossCountInput,
    elements.dpsCountInput
  ].map((input) => Number(input.value || 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  elements.countTotal.textContent = `合计 ${total} / 25`;
  elements.countTotal.classList.toggle("invalid", total !== 25);
}

function slotById(slotId) {
  return appState.slots.find((slot) => slot.id === slotId);
}

async function openSignupDialog(slotId) {
  const slot = slotById(slotId);
  const signup = appState.signups[slotId];
  const draft = appState.drafts?.[slotId];
  const owned = currentUser && signup && signup.qq === currentUser.qq;
  const ownDraft = isOwnDraft(draft);

  if (!currentUser) {
    showToast("请先输入 QQ 号登录");
    elements.qqInput.focus();
    return;
  }

  if (signup && !owned && !appState.isAdmin) {
    showToast("已报名位置只可查看，不能修改。");
    return;
  }

  if (draft && !ownDraft && !appState.isAdmin) {
    showToast(`${displayActor(draft)}正在填写中`);
    return;
  }

  if (appState.activity.status === "closed" && !appState.isAdmin) {
    showToast("当前活动已关闭报名");
    return;
  }

  try {
    if (!signup) {
      appState = await api("/api/drafts", {
        method: "POST",
        body: JSON.stringify({
          qq: currentUser.qq,
          displayName: currentUser.displayName || "",
          slotId
        })
      });
      renderAll({ preserveAdminForm: true, skipAudit: true });
    }
  } catch (error) {
    await loadState({ preserveAdminForm: true, skipAudit: true }).catch(() => {});
    showToast(error.message);
    return;
  }

  selectedSlot = slot;
  elements.slotIdInput.value = slot.id;
  elements.dialogRole.textContent = slot.label;
  elements.dialogTitle.textContent = signup ? (appState.isAdmin ? "管理员调整报名" : "修改报名") : "填写报名";
  elements.dialogQqInput.value = currentUser.displayName
    ? `${currentUser.displayName} · QQ ${currentUser.qq}`
    : currentUser.qq;
  elements.signupIdInput.value = signup?.signupId || "";
  elements.buffStacksInput.value = signup?.buffStacks || "0";
  elements.gearScoreInput.value = signup?.gearScore || "";
  elements.noteInput.value = signup?.note || "";
  elements.deleteSignupBtn.hidden = !signup || !appState.isAdmin;

  renderSpecOptions(slot.role, signup);
  elements.specField.hidden = slot.role === "boss";
  elements.buffField.hidden = !(slot.role === "tank" || slot.role === "healer");
  elements.gearField.hidden = slot.role !== "dps";
  elements.noteField.hidden = slot.role !== "boss";

  startDraftHeartbeat(slot.id);
  elements.signupDialog.showModal();
}

function renderSpecOptions(role, signup) {
  const specs = appState.options.specs[role] || [];
  elements.specInput.innerHTML = specs
    .map((spec) => `<option value="${escapeHtml(spec)}">${escapeHtml(spec)}</option>`)
    .join("");
  elements.specInput.value = signup?.spec || specs[0] || "";
}

function startDraftHeartbeat(slotId) {
  stopDraftHeartbeat();
  const signup = appState.signups[slotId];
  if (signup) {
    return;
  }
  draftHeartbeat = setInterval(async () => {
    if (!currentUser || !elements.signupDialog.open) {
      stopDraftHeartbeat();
      return;
    }
    try {
      appState = await api("/api/drafts", {
        method: "POST",
        body: JSON.stringify({
          qq: currentUser.qq,
          displayName: currentUser.displayName || "",
          slotId
        })
      });
      renderAll({ preserveAdminForm: true, skipAudit: true });
    } catch (error) {
      stopDraftHeartbeat();
      showToast(error.message);
    }
  }, 30000);
}

function stopDraftHeartbeat() {
  if (draftHeartbeat) {
    clearInterval(draftHeartbeat);
    draftHeartbeat = null;
  }
}

async function releaseSelectedDraft() {
  stopDraftHeartbeat();
  if (!selectedSlot || !currentUser) {
    selectedSlot = null;
    return;
  }
  const slotId = selectedSlot.id;
  const draft = appState?.drafts?.[slotId];
  const signup = appState?.signups?.[slotId];
  selectedSlot = null;
  if (!draft || signup || draft.qq !== currentUser.qq) {
    return;
  }

  try {
    appState = await api(`/api/drafts/${encodeURIComponent(slotId)}`, {
      method: "DELETE",
      body: JSON.stringify({ qq: currentUser.qq })
    });
    renderAll({ preserveAdminForm: true, skipAudit: true });
  } catch {
    await loadState({ preserveAdminForm: true, skipAudit: true }).catch(() => {});
  }
}

async function submitSignup(event) {
  event.preventDefault();
  if (!selectedSlot || !currentUser) {
    return;
  }

  const body = {
    qq: currentUser.qq,
    slotId: selectedSlot.id,
    spec: selectedSlot.role === "boss" ? "老板" : elements.specInput.value,
    signupId: elements.signupIdInput.value,
    buffStacks: elements.buffStacksInput.value || 0,
    gearScore: elements.gearScoreInput.value || 0,
    note: elements.noteInput.value
  };

  try {
    appState = await api("/api/signups", {
      method: "POST",
      body: JSON.stringify(body)
    });
    stopDraftHeartbeat();
    selectedSlot = null;
    elements.signupDialog.close();
    renderAll();
    showToast("报名已保存");
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteSignup() {
  if (!selectedSlot || !appState?.isAdmin) {
    return;
  }

  if (!confirm("确定撤销这个报名吗？")) {
    return;
  }

  try {
    appState = await api(`/api/signups/${encodeURIComponent(selectedSlot.id)}`, {
      method: "DELETE",
      body: JSON.stringify({ qq: currentUser?.qq || "" })
    });
    stopDraftHeartbeat();
    selectedSlot = null;
    elements.signupDialog.close();
    renderAll();
    showToast("报名已撤销");
  } catch (error) {
    showToast(error.message);
  }
}

async function submitLogin(event) {
  event.preventDefault();
  try {
    const payload = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        qq: elements.qqInput.value,
        displayName: elements.displayNameInput?.value || ""
      })
    });
    saveUser(payload.user);
    renderAll();
    showToast("登录成功");
  } catch (error) {
    showToast(error.message);
  }
}

async function submitAdminLogin(event) {
  event.preventDefault();
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: elements.adminPasswordInput.value })
    });
    elements.adminDialog.close();
    elements.adminPasswordInput.value = "";
    auditLoadedOnce = false;
    await loadState();
    showToast("管理员已登录");
  } catch (error) {
    showToast(error.message);
  }
}

async function submitActivity(event) {
  event.preventDefault();
  const counts = {
    tank: Number(elements.tankCountInput.value),
    healer: Number(elements.healerCountInput.value),
    boss: Number(elements.bossCountInput.value),
    dps: Number(elements.dpsCountInput.value)
  };

  try {
    appState = await api("/api/activity", {
      method: "POST",
      body: JSON.stringify({
        name: elements.activityNameInput.value,
        instanceName: elements.instanceInput.value,
        type: elements.typeInput.value,
        startTime: elements.startTimeInput.value,
        endTime: elements.endTimeInput.value,
        status: elements.statusInput.value,
        counts
      })
    });
    auditLoadedOnce = false;
    renderAll();
    showToast("活动设置已保存");
  } catch (error) {
    showToast(error.message);
  }
}

async function loadAudit() {
  if (!appState?.isAdmin) {
    return;
  }
  try {
    const payload = await api("/api/admin/audit");
    elements.auditList.innerHTML = payload.audit.length
      ? payload.audit.map(renderAuditItem).join("")
      : `<div class="audit-item"><strong>暂无记录</strong><span>有填写或修改后会显示在这里。</span></div>`;
  } catch (error) {
    elements.auditList.innerHTML = `<div class="audit-item"><strong>读取失败</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function renderAuditItem(item) {
  const time = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(item.at));
  return `
    <div class="audit-item">
      <strong>${escapeHtml(item.summary || item.action)}</strong>
      <span>${escapeHtml(time)} · 操作人 ${escapeHtml(item.actor)} · ${escapeHtml(item.action)} · ${escapeHtml(item.target)}</span>
    </div>
  `;
}

async function clearSignups() {
  if (!confirm("确定清空当前活动的全部报名信息吗？审计记录会保留。")) {
    return;
  }
  try {
    appState = await api("/api/activity/clear", {
      method: "POST",
      body: JSON.stringify({ reason: "活动结束，清空全部报名" })
    });
    auditLoadedOnce = false;
    renderAll();
    showToast("报名已清空");
  } catch (error) {
    showToast(error.message);
  }
}

async function adminLogout() {
  try {
    await api("/api/admin/logout", { method: "POST", body: "{}" });
    auditLoadedOnce = false;
    await loadState();
    showToast("已退出后台");
  } catch (error) {
    showToast(error.message);
  }
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    if (document.hidden) {
      return;
    }
    try {
      await loadState({ preserveAdminForm: true, skipAudit: true });
    } catch {
      // 下一轮刷新会继续尝试。
    }
  }, 5000);
}

elements.loginForm.addEventListener("submit", submitLogin);
elements.logoutBtn.addEventListener("click", async () => {
  if (selectedSlot) {
    await releaseSelectedDraft();
  }
  saveUser(null);
  renderAll();
  showToast("已登出");
});
elements.refreshBtn.addEventListener("click", async () => {
  await loadState({ skipAudit: true });
  showToast("已刷新");
});
elements.adminToggleBtn.addEventListener("click", () => {
  if (appState?.isAdmin) {
    elements.adminPanel.hidden = !elements.adminPanel.hidden;
  } else {
    elements.adminDialog.showModal();
  }
});
elements.closeDialogBtn.addEventListener("click", () => elements.signupDialog.close());
elements.signupDialog.addEventListener("close", releaseSelectedDraft);
elements.closeAdminDialogBtn.addEventListener("click", () => elements.adminDialog.close());
elements.signupForm.addEventListener("submit", submitSignup);
elements.deleteSignupBtn.addEventListener("click", deleteSignup);
elements.adminLoginForm.addEventListener("submit", submitAdminLogin);
elements.activityForm.addEventListener("submit", submitActivity);
elements.refreshAuditBtn.addEventListener("click", loadAudit);
elements.clearSignupsBtn.addEventListener("click", clearSignups);
elements.adminLogoutBtn.addEventListener("click", adminLogout);

for (const input of [
  elements.tankCountInput,
  elements.healerCountInput,
  elements.bossCountInput,
  elements.dpsCountInput
]) {
  input.addEventListener("input", updateCountTotal);
}

loadState()
  .then(startAutoRefresh)
  .catch((error) => {
    showToast(error.message);
  });
