const roleOrder = ["dps", "tank", "healer"];
const roleLabels = {
  tank: "T",
  healer: "奶",
  dps: "输出"
};

let appState = null;
let currentUser = loadUser();
let selectedActivityId = localStorage.getItem("selectedActivityId") || "";
let selectedSlot = null;
let selectedSlotActivityId = "";
let draftHeartbeat = null;
let refreshTimer = null;
let auditLoadedOnce = false;
let isCreatingActivity = false;
let adminPanelVisible = localStorage.getItem("adminPanelVisible") === "true";
let settingsFormDirty = false;

const elements = {
  // activitySubtitle was renamed to brandSubtitle in branding commit
  userBadge: document.querySelector("#userBadge"),
  logoutBtn: document.querySelector("#logoutBtn"),
  adminToggleBtn: document.querySelector("#adminToggleBtn"),
  loginPanel: document.querySelector("#loginPanel"),
  loginForm: document.querySelector("#loginForm"),
  qqInput: document.querySelector("#qqInput"),
  displayNameInput: document.querySelector("#displayNameInput"),
  activityListSection: document.querySelector("#activityListSection"),
  activityCards: document.querySelector("#activityCards"),
  emptyActivities: document.querySelector("#emptyActivities"),
  refreshActivitiesBtn: document.querySelector("#refreshActivitiesBtn"),
  detailPanel: document.querySelector("#detailPanel"),
  statusPill: document.querySelector("#statusPill"),
  timeRange: document.querySelector("#timeRange"),
  activityTitle: document.querySelector("#activityTitle"),
  activityMeta: document.querySelector("#activityMeta"),
  summaryStats: document.querySelector("#summaryStats"),
  adminPanel: document.querySelector("#adminPanel"),
  activityForm: document.querySelector("#activityForm"),
  activityFormTitle: document.querySelector("#activityFormTitle"),
  activityIdInput: document.querySelector("#activityIdInput"),
  activityNameInput: document.querySelector("#activityNameInput"),
  difficultyInput: document.querySelector("#difficultyInput"),
  typeInput: document.querySelector("#typeInput"),
  creatorNameInput: document.querySelector("#creatorNameInput"),
  creatorQqInput: document.querySelector("#creatorQqInput"),
  startTimeInput: document.querySelector("#startTimeInput"),
  endTimeInput: document.querySelector("#endTimeInput"),
  statusInput: document.querySelector("#statusInput"),
  tankCountInput: document.querySelector("#tankCountInput"),
  healerCountInput: document.querySelector("#healerCountInput"),
  dpsCountInput: document.querySelector("#dpsCountInput"),
  countTotal: document.querySelector("#countTotal"),
  newActivityBtn: document.querySelector("#newActivityBtn"),
  activitySubmitBtn: document.querySelector("#activitySubmitBtn"),
  refreshAuditBtn: document.querySelector("#refreshAuditBtn"),
  clearActivityBtn: document.querySelector("#clearActivityBtn"),
  adminLogoutBtn: document.querySelector("#adminLogoutBtn"),
  deleteActivityBtn: document.querySelector("#deleteActivityBtn"),
  auditList: document.querySelector("#auditList"),
  boardHint: document.querySelector("#boardHint"),
  backToListBtn: document.querySelector("#backToListBtn"),
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
  bossToggleField: document.querySelector("#bossToggleField"),
  isBossInput: document.querySelector("#isBossInput"),
  deleteSignupBtn: document.querySelector("#deleteSignupBtn"),
  adminDialog: document.querySelector("#adminDialog"),
  adminLoginForm: document.querySelector("#adminLoginForm"),
  adminPasswordInput: document.querySelector("#adminPasswordInput"),
  closeAdminDialogBtn: document.querySelector("#closeAdminDialogBtn"),
  brandLogo: document.querySelector("#brandLogo"),
  brandLogoText: document.querySelector("#brandLogoText"),
  brandLogoImg: document.querySelector("#brandLogoImg"),
  brandTitle: document.querySelector("#brandTitle"),
  brandSubtitle: document.querySelector("#brandSubtitle"),
  settingsBrandTitle: document.querySelector("#settingsBrandTitle"),
  settingsBrandSubtitle: document.querySelector("#settingsBrandSubtitle"),
  settingsBgColor: document.querySelector("#settingsBgColor"),
  bgColorPreview: document.querySelector("#bgColorPreview"),
  saveSettingsBtn: document.querySelector("#saveSettingsBtn"),
  settingsLogoFile: document.querySelector("#settingsLogoFile"),
  uploadLogoBtn: document.querySelector("#uploadLogoBtn"),
  logoPreview: document.querySelector("#logoPreview"),
  logoPreviewImg: document.querySelector("#logoPreviewImg"),
  removeLogoBtn: document.querySelector("#removeLogoBtn"),
  adminPasswordForm: document.querySelector("#adminPasswordForm"),
  currentAdminPasswordInput: document.querySelector("#currentAdminPasswordInput"),
  newAdminPasswordInput: document.querySelector("#newAdminPasswordInput"),
  confirmAdminPasswordInput: document.querySelector("#confirmAdminPasswordInput"),
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
  const inferredType =
    type !== "info"
      ? type
      : /失败|错误|不能|需要|请先|关闭|结束|已报名|不存在|只可|冲突|不正确/.test(message)
        ? "error"
        : /成功|已保存|已刷新|已登录|已退出|已清空|已登出|已撤销|已创建/.test(message)
          ? "success"
          : "info";
  elements.toast.textContent = message;
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

function formatTimeRange(activity) {
  if (!activity?.startTime && !activity?.endTime) {
    return "时间待定";
  }
  return `${formatDateTime(activity.startTime) || "开始待定"} - ${formatDateTime(activity.endTime) || "结束待定"}`;
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

function renderActivityCards() {
  const activities = appState.activities || [];
  elements.emptyActivities.hidden = activities.length > 0;
  elements.activityCards.innerHTML = activities
    .map((activity) => {
      const selected = activity.id === selectedActivityId;
      return `
        <article class="activity-card ${selected ? "selected" : ""}" data-activity-id="${activity.id}">
          <div class="activity-card-top">
            <strong class="activity-card-title">${escapeHtml(activity.title)}</strong>
            <span class="activity-status ${activity.status}">${escapeHtml(activity.statusLabel)}</span>
          </div>
          <div class="activity-card-meta">
            <span class="difficulty-pill ${activity.difficulty}">${escapeHtml(activity.difficultyLabel)}</span>
            <span>${escapeHtml(formatTimeRange(activity))}</span>
          </div>
          <div class="activity-card-foot">
            <span>创建者：${escapeHtml(activity.creatorLabel)}</span>
            <span>${activity.signed}/${activity.total} 已报名</span>
          </div>
          <button class="primary-button detail-button" type="button" data-activity-id="${activity.id}">查看详情</button>
        </article>
      `;
    })
    .join("");

  for (const card of elements.activityCards.querySelectorAll(".activity-card")) {
    card.addEventListener("click", (event) => {
      const id = event.currentTarget.dataset.activityId;
      selectActivity(id);
    });
  }
}

function renderSummary() {
  const activity = appState.activity;
  if (!activity) {
    elements.detailPanel.hidden = true;
    return;
  }

  elements.detailPanel.hidden = false;

  elements.activityTitle.textContent = activity.title || "25人副本报名";
  elements.activityMeta.textContent = `${activity.difficultyLabel} · ${activity.type || "普通活动"} · 创建者 ${activity.creatorLabel}`;
  elements.timeRange.textContent = formatTimeRange(activity);
  elements.statusPill.textContent = activity.statusLabel;
  elements.statusPill.className = `status-pill ${activity.status}`;

  elements.summaryStats.innerHTML = roleOrder
    .filter((role) => countRole(role) > 0)
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
    .join("") + (() => {
      const bossCount = Object.values(appState.signups || {}).filter((s) => s && s.isBoss).length;
      return bossCount > 0
        ? `<div class="stat boss"><strong>👑 ${bossCount}</strong><span>老板出战</span></div>`
        : "";
    })();
}

function fillActivityForm(activity) {
  const source =
    activity || {
      id: "",
      title: "",
      difficulty: "normal",
      type: "普通活动",
      startTime: "",
      endTime: "",
      status: "active",
      creator: { name: currentUser?.displayName || "管理员", qq: currentUser?.qq || "" },
      counts: { tank: 4, healer: 5, boss: 0, dps: 16 }
    };

  elements.activityIdInput.value = source.id || "";
  elements.activityNameInput.value = source.title || "";
  elements.difficultyInput.value = source.difficulty || "normal";
  elements.typeInput.value = source.type || "普通活动";
  elements.creatorNameInput.value = source.creator?.name || "";
  elements.creatorQqInput.value = source.creator?.qq || "";
  elements.startTimeInput.value = toLocalInputValue(source.startTime);
  elements.endTimeInput.value = toLocalInputValue(source.endTime);
  elements.statusInput.value = source.status || "active";
  elements.tankCountInput.value = source.counts?.tank ?? 4;
  elements.healerCountInput.value = source.counts?.healer ?? 5;
  elements.dpsCountInput.value = source.counts?.dps ?? 16;
  elements.activityFormTitle.textContent = source.id ? "编辑当前活动" : "创建新活动";
  elements.activitySubmitBtn.textContent = source.id ? "保存活动" : "创建活动";
  updateCountTotal();
}

function renderAdminPanel(options = {}) {
  // 用户手动隐藏/显示优先于自动刷新
  elements.adminPanel.hidden = !appState.isAdmin || !adminPanelVisible;
  if (!appState.isAdmin) {
    auditLoadedOnce = false;
    isCreatingActivity = false;
    return;
  }

  const shouldPreserveForm =
    options.preserveAdminForm || elements.activityForm.contains(document.activeElement);
  if (!shouldPreserveForm) {
    fillActivityForm(isCreatingActivity ? null : appState.activity);
  }

  if (!options.skipAudit && !auditLoadedOnce) {
    auditLoadedOnce = true;
    loadAudit();
  }
  const shouldPreserveSettingsForm =
    settingsFormDirty ||
    [
      elements.settingsBrandTitle,
      elements.settingsBrandSubtitle,
      elements.settingsBgColor
    ].includes(document.activeElement);
  fillSettingsForm({ preserveInputs: shouldPreserveSettingsForm });
}

function fillSettingsForm(options = {}) {
  if (!appState?.settings) {
    return;
  }
  const s = appState.settings;
  if (!options.preserveInputs) {
    elements.settingsBrandTitle.value = s.brandTitle || "";
    elements.settingsBrandSubtitle.value = s.brandSubtitle || "";
    elements.settingsBgColor.value = s.bgColor || "";
    updateBgPreview();
  }
  updateLogoPreview();
}

function updateLogoPreview() {
  if (!appState?.settings) {
    return;
  }
  const path = appState.settings.brandLogoPath;
  if (path) {
    elements.logoPreviewImg.src = path;
    elements.logoPreview.hidden = false;
  } else {
    elements.logoPreview.hidden = true;
  }
}

async function uploadLogo() {
  const file = elements.settingsLogoFile.files?.[0];
  if (!file) {
    showToast("请先选择一张图片");
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast("图片大小不能超过 2MB");
    return;
  }
  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const payload = await api("/api/settings/logo", {
      method: "POST",
      body: JSON.stringify({ image: base64 })
    });
    appState.settings.brandLogoPath = payload.logoPath;
    renderAll({ preserveAdminForm: true, skipAudit: true });
    elements.settingsLogoFile.value = "";
    showToast("Logo 已上传");
  } catch (error) {
    showToast(error.message);
  }
}

async function removeLogo() {
  if (!confirm("确定移除自定义 Logo 图片吗？将恢复默认文字 Logo。")) {
    return;
  }
  try {
    const payload = await api("/api/settings/logo", {
      method: "POST",
      body: JSON.stringify({ image: "" })
    });
    appState.settings.brandLogoPath = "";
    renderAll({ preserveAdminForm: true, skipAudit: true });
    showToast("Logo 已移除");
  } catch (error) {
    showToast(error.message);
  }
}

function updateBgPreview() {
  const color = elements.settingsBgColor.value;
  if (/^#[0-9a-fA-F]{3,6}$/.test(color)) {
    elements.bgColorPreview.style.background = color;
    elements.bgColorPreview.hidden = false;
  } else {
    elements.bgColorPreview.hidden = true;
  }
}

async function saveSettings() {
  if (!appState?.isAdmin) {
    return;
  }
  const body = {
    brandTitle: elements.settingsBrandTitle.value,
    brandSubtitle: elements.settingsBrandSubtitle.value,
    bgColor: elements.settingsBgColor.value
  };
  try {
    const payload = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify(body)
    });
    appState.settings = payload.settings;
    settingsFormDirty = false;
    renderAll({ preserveAdminForm: true, skipAudit: true });
    showToast("品牌设置已保存");
  } catch (error) {
    showToast(error.message);
  }
}

async function changeAdminPassword(event) {
  event.preventDefault();
  if (!appState?.isAdmin) {
    return;
  }

  const currentPassword = elements.currentAdminPasswordInput.value;
  const newPassword = elements.newAdminPasswordInput.value.trim();
  const confirmPassword = elements.confirmAdminPasswordInput.value.trim();
  if (newPassword.length < 6) {
    showToast("新密码长度至少 6 位");
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast("两次输入的新密码不一致");
    return;
  }

  try {
    await api("/api/admin/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword,
        newPassword,
        confirmPassword
      })
    });
    elements.adminPasswordForm.reset();
    auditLoadedOnce = false;
    await loadState({ activityId: selectedActivityId, preserveAdminForm: true, skipAudit: true });
    showToast("管理员密码已修改", "success");
  } catch (error) {
    showToast(error.message);
  }
}

function renderBoard() {
  const slots = appState.slots; // 已按 gridColumn, gridRow 排序

  // 按列分组
  const byColumn = {};
  for (const slot of slots) {
    const col = slot.gridColumn;
    if (!byColumn[col]) byColumn[col] = [];
    byColumn[col].push(slot);
  }

  const colHeaders = { 1: "输出一", 2: "输出二", 3: "输出三", 4: "T 位", 5: "奶 位" };
  const colRoles = { 1: "dps", 2: "dps", 3: "dps", 4: "tank", 5: "healer" };

  const colNums = Object.keys(byColumn).map(Number).sort((a, b) => a - b);

  const html = `<div class="board-5x5">${colNums
    .map((col) => {
      const colSlots = byColumn[col];
      const role = colRoles[col] || colSlots[0]?.role || "dps";
      const signed = colSlots.filter((s) => appState.signups[s.id]).length;
      const total = colSlots.length;
      return `
        <div class="board-col">
          <div class="board-col-head ${role}">
            <span class="col-label">${colHeaders[col] || ""}</span>
            <span class="col-stat">${signed}/${total}</span>
          </div>
          ${colSlots.map(renderSlot).join("")}
        </div>
      `;
    })
    .join("")}</div>`;

  elements.board.innerHTML = html;

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
  const isBoss = Boolean(signup?.isBoss);
  const status = occupied ? (owned ? "我的报名" : "已定") : drafting ? "填写中" : "空位";
  const action = getSlotAction(signup, draft, owned, ownDraft);
  const body = signup
    ? renderSignupBody(slot.role, signup)
    : drafting
      ? renderDraftBody(draft, ownDraft)
      : `<span class="slot-empty">虚席以待</span>`;

  const classes = [
    "slot-card",
    occupied ? "occupied" : "",
    owned ? "owned" : "",
    drafting ? "drafting" : "",
    ownDraft ? "own-draft" : "",
    isBoss ? "is-boss" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const bossBadge = isBoss ? `<span class="boss-badge">👑 老板</span>` : "";

  // 老板徽章放入 slot-body 内，避免多出一个 grid 子项打乱 1fr 分配
  const bodyWithBadge = bossBadge ? `${bossBadge}${body}` : body;

  return `
    <button class="${classes}" type="button" data-slot-id="${slot.id}">
      <span class="slot-top">
        <span class="slot-tag ${slot.role}">${slot.label}</span>
        <span class="slot-status">${status}</span>
      </span>
      <span class="slot-body">${bodyWithBadge}</span>
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
  if (signup.spec) {
    meta.push(`<span class="signup-chip spec">${escapeHtml(signup.spec)}</span>`);
  }
  if (!signup.isBoss && (role === "tank" || role === "healer") && signup.buffStacks !== "") {
    meta.push(`<span class="signup-chip">增益 ${escapeHtml(signup.buffStacks)}</span>`);
  }
  if (!signup.isBoss && role === "dps" && signup.gearScore !== "") {
    meta.push(`<span class="signup-chip">装分 ${escapeHtml(signup.gearScore)}</span>`);
  }
  if (signup.note) {
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

function renderBrand() {
  if (!appState?.settings) {
    return;
  }
  const s = appState.settings;
  if (s.brandLogoPath) {
    elements.brandLogoText.hidden = true;
    elements.brandLogoImg.hidden = false;
    elements.brandLogoImg.src = s.brandLogoPath;
  } else {
    elements.brandLogoText.hidden = false;
    elements.brandLogoImg.hidden = true;
    elements.brandLogoText.textContent = s.brandLogo || "令";
  }
  elements.brandTitle.textContent = s.brandTitle || "团本召集令";
  elements.brandSubtitle.textContent = s.brandSubtitle || "";
}

function applyBackground() {
  if (!appState?.settings?.bgColor) {
    return;
  }
  document.documentElement.style.setProperty("--custom-bg", appState.settings.bgColor);
}

function renderAll(options = {}) {
  renderUser();
  renderBrand();
  applyBackground();
  renderActivityCards();
  renderSummary();
  renderAdminPanel(options);
  renderBoard();
}

async function loadState(options = {}) {
  const id = options.activityId ?? selectedActivityId;
  const query = id ? `?activityId=${encodeURIComponent(id)}` : "";
  appState = await api(`/api/state${query}`);
  selectedActivityId = appState.selectedActivityId;
  if (selectedActivityId) {
    localStorage.setItem("selectedActivityId", selectedActivityId);
  }
  renderAll(options);
}

async function selectActivity(activityId) {
  if (selectedSlot) {
    await releaseSelectedDraft();
  }
  isCreatingActivity = false;
  selectedActivityId = activityId;
  localStorage.setItem("selectedActivityId", activityId);
  await loadState({ activityId });
  elements.detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateCountTotal() {
  const values = [
    elements.tankCountInput,
    elements.healerCountInput,
    elements.dpsCountInput
  ].filter(Boolean).map((input) => Number(input.value || 0));
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

  if (appState.activity.status === "ended" && !appState.isAdmin) {
    showToast("当前活动已结束");
    return;
  }

  try {
    if (!signup) {
      appState = await api("/api/drafts", {
        method: "POST",
        body: JSON.stringify({
          activityId: selectedActivityId,
          qq: currentUser.qq,
          displayName: currentUser.displayName || "",
          slotId
        })
      });
      renderAll({ preserveAdminForm: true, skipAudit: true });
    }
  } catch (error) {
    await loadState({ activityId: selectedActivityId, preserveAdminForm: true, skipAudit: true }).catch(() => {});
    showToast(error.message);
    return;
  }

  selectedSlot = slot;
  selectedSlotActivityId = selectedActivityId;
  elements.slotIdInput.value = slot.id;
  elements.dialogRole.textContent = `${appState.activity.title} · ${slot.label}`;
  elements.dialogTitle.textContent = signup ? (appState.isAdmin ? "管理员调整报名" : "修改报名") : "填写报名";
  elements.dialogQqInput.value = currentUser.displayName
    ? `${currentUser.displayName} · QQ ${currentUser.qq}`
    : currentUser.qq;
  elements.signupIdInput.value = signup?.signupId || "";
  elements.buffStacksInput.value = signup?.buffStacks || "0";
  elements.gearScoreInput.value = signup?.gearScore || "";
  elements.noteInput.value = signup?.note || "";
  elements.isBossInput.checked = Boolean(signup?.isBoss);
  elements.deleteSignupBtn.hidden = !signup || !(appState.isAdmin || owned);
  elements.deleteSignupBtn.textContent = owned && !appState.isAdmin ? "撤销我的报名" : "撤销报名";

  function refreshDialogFields() {
    const isBoss = elements.isBossInput.checked;
    renderSpecOptions(slot.role, signup, isBoss);
    elements.buffField.hidden = isBoss || !(slot.role === "tank" || slot.role === "healer");
    elements.gearField.hidden = isBoss || slot.role !== "dps";
    elements.noteField.hidden = !isBoss;
  }

  elements.isBossInput.onchange = refreshDialogFields;
  refreshDialogFields();

  startDraftHeartbeat(slot.id);
  elements.signupDialog.showModal();
}

function renderSpecOptions(role, signup, isBoss = false) {
  const allSpecs = [
    ...appState.options.specs.tank,
    ...appState.options.specs.healer,
    ...appState.options.specs.dps
  ];
  const specs = isBoss ? allSpecs : (appState.options.specs[role] || []);
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
          activityId: selectedSlotActivityId,
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
    selectedSlotActivityId = "";
    return;
  }
  const slotId = selectedSlot.id;
  const activityId = selectedSlotActivityId;
  const draft = appState?.drafts?.[slotId];
  const signup = appState?.signups?.[slotId];
  selectedSlot = null;
  selectedSlotActivityId = "";
  if (!draft || signup || draft.qq !== currentUser.qq) {
    return;
  }

  try {
    appState = await api(`/api/drafts/${encodeURIComponent(slotId)}`, {
      method: "DELETE",
      body: JSON.stringify({ activityId, qq: currentUser.qq })
    });
    renderAll({ preserveAdminForm: true, skipAudit: true });
  } catch {
    await loadState({ activityId: selectedActivityId, preserveAdminForm: true, skipAudit: true }).catch(() => {});
  }
}

async function submitSignup(event) {
  event.preventDefault();
  if (!selectedSlot || !currentUser) {
    return;
  }

  const body = {
    activityId: selectedSlotActivityId || selectedActivityId,
    qq: currentUser.qq,
    slotId: selectedSlot.id,
    spec: elements.specInput.value,
    signupId: elements.signupIdInput.value,
    buffStacks: elements.buffStacksInput.value || 0,
    gearScore: elements.gearScoreInput.value || 0,
    note: elements.noteInput.value,
    isBoss: elements.isBossInput.checked
  };

  try {
    appState = await api("/api/signups", {
      method: "POST",
      body: JSON.stringify(body)
    });
    stopDraftHeartbeat();
    selectedSlot = null;
    selectedSlotActivityId = "";
    elements.signupDialog.close();
    renderAll();
    showToast("报名已保存");
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteSignup() {
  if (!selectedSlot || !currentUser) {
    return;
  }
  const signup = appState?.signups?.[selectedSlot.id];
  if (!signup) {
    return;
  }
  const isOwner = signup.qq === currentUser.qq;
  if (!appState?.isAdmin && !isOwner) {
    return;
  }

  if (!confirm(isOwner && !appState?.isAdmin ? "确定撤销自己的报名吗？" : "确定撤销这个报名吗？")) {
    return;
  }

  try {
    appState = await api(`/api/signups/${encodeURIComponent(selectedSlot.id)}`, {
      method: "DELETE",
      body: JSON.stringify({ activityId: selectedSlotActivityId || selectedActivityId })
    });
    stopDraftHeartbeat();
    selectedSlot = null;
    selectedSlotActivityId = "";
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
    adminPanelVisible = true;
    localStorage.setItem("adminPanelVisible", "true");
    await loadState({ activityId: selectedActivityId });
    showToast("管理员已登录");
  } catch (error) {
    showToast(error.message);
  }
}

function activityFormPayload() {
  return {
    activityId: elements.activityIdInput.value,
    title: elements.activityNameInput.value,
    difficulty: elements.difficultyInput.value,
    type: elements.typeInput.value,
    creatorName: elements.creatorNameInput.value,
    creatorQq: elements.creatorQqInput.value,
    startTime: elements.startTimeInput.value,
    endTime: elements.endTimeInput.value,
    status: elements.statusInput.value,
    counts: {
      tank: Number(elements.tankCountInput.value),
      healer: Number(elements.healerCountInput.value),
      boss: 0,
      dps: Number(elements.dpsCountInput.value)
    }
  };
}

async function submitActivity(event) {
  event.preventDefault();
  const payload = activityFormPayload();
  const isCreate = !payload.activityId;
  try {
    appState = await api(isCreate ? "/api/activities" : "/api/activity", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    isCreatingActivity = false;
    selectedActivityId = appState.selectedActivityId;
    localStorage.setItem("selectedActivityId", selectedActivityId);
    auditLoadedOnce = false;
    renderAll();
    showToast(isCreate ? "活动已创建" : "活动已保存");
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

async function deleteActivity() {
  if (!appState?.activity?.id) {
    showToast("没有选中的活动");
    return;
  }
  const activityTitle = appState.activity.title;
  if (!confirm(`确定要删除活动「${activityTitle}」吗？此操作不可恢复。`)) {
    return;
  }
  try {
    await api(`/api/activities/${encodeURIComponent(appState.activity.id)}`, {
      method: "DELETE",
      body: JSON.stringify({})
    });
    auditLoadedOnce = false;
    selectedActivityId = "";
    localStorage.removeItem("selectedActivityId");
    await loadState();
    showToast("活动已删除");
  } catch (error) {
    showToast(error.message);
  }
}

async function clearActivitySignups() {
  if (!appState?.activity?.id) {
    showToast("没有选中的活动");
    return;
  }

  const signupCount = Object.keys(appState.signups || {}).length;
  if (signupCount === 0) {
    showToast("当前活动没有报名需要清空");
    return;
  }

  const activityTitle = appState.activity.title;
  if (!confirm(`确定要清空「${activityTitle}」的全部报名吗？活动本身会保留。`)) {
    return;
  }

  try {
    appState = await api("/api/activity/clear", {
      method: "POST",
      body: JSON.stringify({
        activityId: appState.activity.id,
        reason: "管理员清空报名"
      })
    });
    auditLoadedOnce = false;
    renderAll();
    showToast("报名已清空", "success");
  } catch (error) {
    showToast(error.message);
  }
}

async function logoutAdmin() {
  try {
    await api("/api/admin/logout", {
      method: "POST",
      body: JSON.stringify({})
    });
  } catch (error) {
    showToast(error.message);
    return;
  }

  adminPanelVisible = false;
  localStorage.setItem("adminPanelVisible", "false");
  auditLoadedOnce = false;
  await loadState({ activityId: selectedActivityId, preserveAdminForm: true, skipAudit: true });
  showToast("后台已退出", "success");
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    if (document.hidden) {
      return;
    }
    try {
      await loadState({ activityId: selectedActivityId, preserveAdminForm: true, skipAudit: true });
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
elements.refreshActivitiesBtn.addEventListener("click", async () => {
  await loadState({ activityId: selectedActivityId, preserveAdminForm: true, skipAudit: true });
  showToast("活动列表已刷新");
});
elements.refreshBtn.addEventListener("click", async () => {
  await loadState({ activityId: selectedActivityId, preserveAdminForm: true, skipAudit: true });
  showToast("名册已刷新");
});
elements.backToListBtn.addEventListener("click", () => {
  elements.activityListSection.scrollIntoView({ behavior: "smooth", block: "start" });
});
elements.adminToggleBtn.addEventListener("click", () => {
  if (appState?.isAdmin) {
    adminPanelVisible = !adminPanelVisible;
    localStorage.setItem("adminPanelVisible", adminPanelVisible);
    elements.adminPanel.hidden = !appState.isAdmin || !adminPanelVisible;
  } else {
    elements.adminDialog.showModal();
  }
});
elements.newActivityBtn.addEventListener("click", () => {
  isCreatingActivity = true;
  fillActivityForm(null);
});
elements.closeDialogBtn.addEventListener("click", () => elements.signupDialog.close());
elements.signupDialog.addEventListener("close", releaseSelectedDraft);
elements.closeAdminDialogBtn.addEventListener("click", () => elements.adminDialog.close());
elements.signupForm.addEventListener("submit", submitSignup);
elements.deleteSignupBtn.addEventListener("click", deleteSignup);
elements.adminLoginForm.addEventListener("submit", submitAdminLogin);
elements.activityForm.addEventListener("submit", submitActivity);
elements.adminPasswordForm.addEventListener("submit", changeAdminPassword);
elements.refreshAuditBtn.addEventListener("click", loadAudit);
elements.clearActivityBtn.addEventListener("click", clearActivitySignups);
elements.adminLogoutBtn.addEventListener("click", logoutAdmin);
elements.deleteActivityBtn.addEventListener("click", deleteActivity);
elements.saveSettingsBtn.addEventListener("click", saveSettings);
elements.uploadLogoBtn.addEventListener("click", uploadLogo);
elements.removeLogoBtn.addEventListener("click", removeLogo);
elements.settingsBgColor.addEventListener("input", updateBgPreview);

for (const input of [
  elements.settingsBrandTitle,
  elements.settingsBrandSubtitle,
  elements.settingsBgColor
].filter(Boolean)) {
  input.addEventListener("input", () => {
    settingsFormDirty = true;
  });
}

for (const input of [
  elements.tankCountInput,
  elements.healerCountInput,
  elements.dpsCountInput
].filter(Boolean)) {
  input.addEventListener("input", updateCountTotal);
}

loadState()
  .then(startAutoRefresh)
  .catch((error) => {
    showToast(error.message);
  });
