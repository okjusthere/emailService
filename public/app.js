// ── State ────────────────────────────────
let currentPage = "dashboard";
let subscriberPage = 1;
let selectedIds = new Set();
let allTags = [];
let currentCampaignId = null;
let campaignSourceMode = false;
const blockedEditorTags = [
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "meta",
  "base",
  "link",
  "svg",
  "math",
];

// ── API Helper ───────────────────────────
async function api(path, options = {}) {
  const headers = {};
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`/api/admin${path}`, {
    ...options,
    credentials: "same-origin",
    headers: { ...headers, ...options.headers },
  });
  if (res.status === 401 && path !== "/logout") {
    await logout(false);
    throw new Error("Unauthorized");
  }
  return res;
}

// ── Toast ────────────────────────────────
function toast(message, type = "success") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Auth ─────────────────────────────────
function showApp() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
}

async function tryLogin(secret) {
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    if (!res.ok) throw new Error();
    showApp();
    navigateTo("dashboard");
    return true;
  } catch {
    return false;
  }
}

async function logout(performRequest = true) {
  if (performRequest) {
    try {
      await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {}
  }

  document.getElementById("app").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("login-secret").value = "";
  document.getElementById("login-error").classList.add("hidden");
}

// ── Navigation ───────────────────────────
function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  document.getElementById(`page-${page}`).classList.remove("hidden");
  document.querySelectorAll(".nav-links a").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === page);
  });
  if (page === "dashboard") loadDashboard();
  else if (page === "subscribers") { loadTags(); loadSubscribers(); }
  else if (page === "campaigns") { loadTags(); loadCampaignList(); }
  else if (page === "history") loadHistory();
}

// ── Dashboard ────────────────────────────
async function loadDashboard() {
  try {
    const res = await api("/stats");
    const data = await res.json();
    const s = data.subscribers;
    document.getElementById("stat-total").textContent = (s.total || 0).toLocaleString();
    document.getElementById("stat-active").textContent = (s.active || 0).toLocaleString();
    document.getElementById("stat-unsubscribed").textContent = (s.unsubscribed || 0).toLocaleString();
    document.getElementById("stat-bounced").textContent = (s.bounced || 0).toLocaleString();
    document.getElementById("stat-complained").textContent = (s.complained || 0).toLocaleString();
    document.getElementById("stat-today").textContent = (data.todaySentCount || 0).toLocaleString();

    // Engagement stats
    const e = data.engagement;
    document.getElementById("eng-total").textContent = (e.totalSent || 0).toLocaleString();
    document.getElementById("eng-delivered").textContent = (e.delivered || 0).toLocaleString();
    document.getElementById("eng-open-rate").textContent = `${e.openRate}%`;
    document.getElementById("eng-click-rate").textContent = `${e.clickRate}%`;
    document.getElementById("eng-bounce-rate").textContent = `${e.bounceRate}%`;

    // Warmup banner
    const wb = document.getElementById("warmup-banner");
    if (data.warmup?.isWarmingUp) {
      wb.classList.remove("hidden");
      document.getElementById("warmup-text").textContent =
        `IP Warmup: Day ${data.warmup.day}/14 — Daily limit: ${data.warmup.limit} emails`;
    } else {
      wb.classList.add("hidden");
    }

    // Recent batches
    const tbody = document.getElementById("recent-batches-body");
    if (!data.recentBatches?.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="center">No batches yet</td></tr>';
      return;
    }
    tbody.innerHTML = data.recentBatches.map((b) => `
      <tr>
        <td><code>${b.id.slice(0, 8)}...</code></td>
        <td><span class="badge badge-${b.status}">${b.status}</span></td>
        <td>${b.sent_count}</td>
        <td>${b.failed_count}</td>
        <td>${formatDate(b.created_at)}</td>
      </tr>`).join("");
  } catch (err) {
    toast("Failed to load dashboard", "error");
  }
}

// ── Subscribers ──────────────────────────
async function loadSubscribers() {
  selectedIds.clear();
  updateBulkBar();
  const search = document.getElementById("search-input").value;
  const status = document.getElementById("status-filter").value;
  const tagId = document.getElementById("tag-filter")?.value || "";
  try {
    let url = `/subscribers?page=${subscriberPage}&limit=50&status=${status}&search=${encodeURIComponent(search)}`;
    if (tagId) url += `&tagId=${tagId}`;
    const res = await api(url);
    const data = await res.json();
    const tbody = document.getElementById("subscribers-body");
    const selectAll = document.getElementById("select-all");
    selectAll.checked = false;

    if (!data.subscribers?.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="center">No subscribers found</td></tr>';
      document.getElementById("pagination").innerHTML = "";
      return;
    }
    tbody.innerHTML = data.subscribers.map((s) => `
      <tr>
        <td><input type="checkbox" class="row-select" data-id="${s.id}"></td>
        <td>${escapeHtml(s.email)}</td>
        <td>${escapeHtml(s.name || "—")}</td>
        <td><div class="tag-pill-list">${(s.tags || []).map(t => `<span class="tag-pill">${escapeHtml(t.name)}</span>`).join("") || "—"}</div></td>
        <td><span class="badge badge-${s.status}">${s.status}</span></td>
        <td>${s.send_count || 0}</td>
        <td>${s.last_sent_at ? formatDate(s.last_sent_at) : "—"}</td>
        <td><button class="btn-danger btn-sm" onclick="deleteSubscriber(${s.id})">Delete</button></td>
      </tr>`).join("");

    // Bind row checkboxes
    document.querySelectorAll(".row-select").forEach((cb) => {
      cb.addEventListener("change", () => {
        const id = parseInt(cb.dataset.id);
        if (cb.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        updateBulkBar();
      });
    });

    // Pagination
    const p = data.pagination;
    document.getElementById("pagination").innerHTML = `
      <button ${p.page <= 1 ? "disabled" : ""} onclick="goToPage(${p.page - 1})">← Prev</button>
      <span>Page ${p.page} of ${p.totalPages} (${p.total} total)</span>
      <button ${p.page >= p.totalPages ? "disabled" : ""} onclick="goToPage(${p.page + 1})">Next →</button>
    `;
  } catch {
    toast("Failed to load subscribers", "error");
  }
}

function goToPage(page) { subscriberPage = page; loadSubscribers(); }

async function deleteSubscriber(id) {
  if (!confirm("Delete this subscriber?")) return;
  try {
    await api(`/subscribers/${id}`, { method: "DELETE" });
    toast("Subscriber deleted");
    loadSubscribers();
  } catch { toast("Failed to delete", "error"); }
}

// ── Bulk Operations ──────────────────────
function updateBulkBar() {
  const bar = document.getElementById("bulk-bar");
  if (selectedIds.size > 0) {
    bar.classList.remove("hidden");
    document.getElementById("selected-count").textContent = `${selectedIds.size} selected`;
  } else {
    bar.classList.add("hidden");
  }
}

document.getElementById("select-all")?.addEventListener("change", (e) => {
  const checked = e.target.checked;
  document.querySelectorAll(".row-select").forEach((cb) => {
    cb.checked = checked;
    const id = parseInt(cb.dataset.id);
    if (checked) selectedIds.add(id);
    else selectedIds.delete(id);
  });
  updateBulkBar();
});

document.getElementById("bulk-delete")?.addEventListener("click", async () => {
  if (!confirm(`Delete ${selectedIds.size} subscribers?`)) return;
  try {
    await api("/subscribers/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids: Array.from(selectedIds) }),
    });
    toast(`Deleted ${selectedIds.size} subscribers`);
    loadSubscribers();
  } catch { toast("Bulk delete failed", "error"); }
});

document.getElementById("bulk-activate")?.addEventListener("click", async () => {
  try {
    await api("/subscribers/bulk-status", {
      method: "POST",
      body: JSON.stringify({ ids: Array.from(selectedIds), status: "active" }),
    });
    toast(`Activated ${selectedIds.size} subscribers`);
    loadSubscribers();
  } catch { toast("Bulk activate failed", "error"); }
});

// ── Tags ─────────────────────────────────
async function loadTags() {
  try {
    const res = await api("/tags");
    const data = await res.json();
    allTags = data.tags || [];
    // Populate subscriber tag filter
    const tagFilter = document.getElementById("tag-filter");
    if (tagFilter) {
      const val = tagFilter.value;
      tagFilter.innerHTML = '<option value="">All Tags</option>' + allTags.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${t.subscriber_count || 0})</option>`).join("");
      tagFilter.value = val;
    }
    // Populate tag select in modal
    const tagSelect = document.getElementById("tag-select");
    if (tagSelect) {
      tagSelect.innerHTML = allTags.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
    }
    // Populate campaign tag filter
    const campaignTagFilter = document.getElementById("campaign-tag-filter");
    if (campaignTagFilter) {
      const cval = campaignTagFilter.value;
      campaignTagFilter.innerHTML = '<option value="">All Subscribers</option>' + allTags.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${t.subscriber_count || 0})</option>`).join("");
      campaignTagFilter.value = cval;
    }
  } catch {} // silent
}

document.getElementById("create-tag-btn")?.addEventListener("click", async () => {
  const nameEl = document.getElementById("new-tag-name");
  const name = nameEl.value.trim();
  if (!name) return;
  try {
    const res = await api("/tags", { method: "POST", body: JSON.stringify({ name }) });
    const data = await res.json();
    if (data.success) {
      nameEl.value = "";
      toast(`Tag "${name}" created`);
      await loadTags();
    } else {
      toast(data.error || "Failed", "error");
    }
  } catch { toast("Failed to create tag", "error"); }
});

function openTagModal(action) {
  document.getElementById("tag-action-type").dataset.action = action;
  document.getElementById("tag-modal").classList.remove("hidden");
}

document.getElementById("bulk-tag")?.addEventListener("click", () => openTagModal("tag"));
document.getElementById("bulk-untag")?.addEventListener("click", () => openTagModal("untag"));

document.getElementById("apply-tag-btn")?.addEventListener("click", async () => {
  const action = document.getElementById("tag-action-type").dataset.action;
  const tagId = parseInt(document.getElementById("tag-select").value);
  if (!tagId || selectedIds.size === 0) return;
  try {
    await api(`/subscribers/${action}`, {
      method: "POST",
      body: JSON.stringify({ ids: Array.from(selectedIds), tagId }),
    });
    toast(`${action === "tag" ? "Tagged" : "Untagged"} ${selectedIds.size} subscribers`);
    document.getElementById("tag-modal").classList.add("hidden");
    loadSubscribers();
  } catch { toast("Operation failed", "error"); }
});

// ── CSV Template Download ────────────────
document.getElementById("download-template")?.addEventListener("click", () => {
  const template = "email,name,tags\njohn@example.com,John Doe,VIP;Newsletter\njane@example.com,Jane Smith,Newsletter\n";
  const blob = new Blob([template], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "subscribers_template.csv";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Template downloaded");
});

// ── CSV Upload ───────────────────────────
document.getElementById("upload-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = document.getElementById("csv-file").files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append("csv", file);
  // Append batch tags if specified
  const batchTags = (document.getElementById("batch-tags-input")?.value || "").trim();
  if (batchTags) formData.append("batchTags", batchTags);
  try {
    const res = await api("/subscribers/upload", { method: "POST", body: formData });
    const data = await res.json();
    if (data.success) {
      document.getElementById("upload-result").classList.remove("hidden");
      let resultHtml = `<p style="color: var(--green)">✅ Imported: ${data.imported}, Skipped: ${data.skipped}</p>`;
      if (data.taggedCount > 0) {
        resultHtml += `<p style="color: var(--green)">🏷 Tagged: ${data.taggedCount} assignments (${data.tagsCreated} tag${data.tagsCreated !== 1 ? 's' : ''} used)</p>`;
      }
      document.getElementById("upload-result").innerHTML = resultHtml;
      toast(`Imported ${data.imported} subscribers`);
      loadSubscribers();
      loadTags();
    } else {
      toast(data.error || "Upload failed", "error");
    }
  } catch { toast("Upload failed", "error"); }
});

// ── CSV Export ───────────────────────────
document.getElementById("export-csv")?.addEventListener("click", () => {
  const status = document.getElementById("status-filter").value;
  const url = `/api/admin/subscribers/export?status=${status}`;
  // Create a temporary link to trigger download with auth
  fetch(url, { credentials: "same-origin" })
    .then((res) => res.blob())
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `subscribers_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast("CSV exported");
    })
    .catch(() => toast("Export failed", "error"));
});

// ── Add Subscriber ───────────────────────
document.getElementById("add-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("add-email").value;
  const name = document.getElementById("add-name").value;
  try {
    const res = await api("/subscribers", { method: "POST", body: JSON.stringify({ email, name }) });
    const data = await res.json();
    if (data.success) {
      toast("Subscriber added");
      document.getElementById("add-email").value = "";
      document.getElementById("add-name").value = "";
      closeModal("add-modal");
      loadSubscribers();
    } else { toast(data.error || "Failed to add", "error"); }
  } catch { toast("Failed to add subscriber", "error"); }
});



// ── History ──────────────────────────────
async function loadHistory() {
  try {
    const res = await api("/batches");
    const data = await res.json();
    const tbody = document.getElementById("history-body");
    if (!data.batches?.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="center">No batches yet</td></tr>';
      return;
    }
    tbody.innerHTML = data.batches.map((b) => `
      <tr>
        <td><code>${b.id.slice(0, 8)}...</code></td>
        <td>${b.total_count}</td>
        <td>${b.sent_count}</td>
        <td>${b.failed_count}</td>
        <td><span class="badge badge-${b.status}">${b.status}</span></td>
        <td>${formatDate(b.started_at)}</td>
        <td>${b.completed_at ? formatDate(b.completed_at) : "—"}</td>
      </tr>`).join("");
  } catch { toast("Failed to load history", "error"); }
}

// ── Modals ───────────────────────────────
function openModal(id) { document.getElementById(id).classList.remove("hidden"); }
function closeModal(id) { document.getElementById(id).classList.add("hidden"); }
document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.close));
});
document.getElementById("open-upload")?.addEventListener("click", () => {
  document.getElementById("upload-result").classList.add("hidden");
  const batchInput = document.getElementById("batch-tags-input");
  if (batchInput) batchInput.value = "";
  openModal("upload-modal");
});
document.getElementById("open-add")?.addEventListener("click", () => {
  document.getElementById("add-result").classList.add("hidden");
  openModal("add-modal");
});
document.querySelectorAll(".modal").forEach((modal) => {
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });
});

// ── Utils ────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function sanitizeEditorHtml(value) {
  let html = String(value || "");

  blockedEditorTags.forEach((tag) => {
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), "");
    html = html.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "");
  });

  html = html.replace(/\son[a-z-]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "");
  html = html.replace(
    /\s(href|src)\s*=\s*(['"])\s*(?:javascript:|vbscript:|data:text\/html)[\s\S]*?\2/gi,
    ""
  );
  html = html.replace(
    /\sstyle\s*=\s*(".*?expression\s*\(.*?\).*?"|'.*?expression\s*\(.*?\).*?'|[^\s>]+)/gi,
    ""
  );

  return html;
}

function formatDate(str) {
  if (!str) return "—";
  const d = new Date(str + (str.includes("Z") ? "" : "Z"));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Event Listeners ──────────────────────
document.querySelectorAll("[data-page]").forEach((link) => {
  link.addEventListener("click", (e) => { e.preventDefault(); navigateTo(link.dataset.page); });
});
document.getElementById("login-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const secret = document.getElementById("login-secret").value;
  const ok = await tryLogin(secret);
  if (!ok) {
    document.getElementById("login-error").textContent = "Invalid secret";
    document.getElementById("login-error").classList.remove("hidden");
  }
});
document.getElementById("logout-btn")?.addEventListener("click", () => {
  void logout();
});
document.getElementById("refresh-stats")?.addEventListener("click", loadDashboard);
document.getElementById("asset-file")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;

  try {
    await uploadInlineAsset(file);
  } catch (err) {
    toast(err.message || "Failed to upload image", "error");
  }
});
document.querySelectorAll(".snippet-btn").forEach((button) => {
  button.addEventListener("click", () => insertHtmlSnippet(button.dataset.snippet));
});

let searchTimeout;
document.getElementById("search-input")?.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => { subscriberPage = 1; loadSubscribers(); }, 300);
});
document.getElementById("status-filter")?.addEventListener("change", () => { subscriberPage = 1; loadSubscribers(); });
document.getElementById("tag-filter")?.addEventListener("change", () => { subscriberPage = 1; loadSubscribers(); });

// ── Campaigns ────────────────────────────
async function loadCampaignList() {
  document.getElementById("campaign-list-view").classList.remove("hidden");
  document.getElementById("campaign-editor-view").classList.add("hidden");
  try {
    const res = await api("/campaigns");
    const data = await res.json();
    const container = document.getElementById("campaign-cards");
    if (!data.campaigns?.length) {
      container.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:40px 0">No campaigns yet. Click "New Campaign" to get started.</p>';
      return;
    }
    container.innerHTML = data.campaigns.map(c => {
      const s = c.stats || {};
      const openRate = s.delivered ? ((s.opened / s.delivered) * 100).toFixed(1) : "0.0";
      return `
        <div class="campaign-card" data-id="${c.id}">
          <div class="campaign-card-header">
            <span class="campaign-card-name">${escapeHtml(c.name)}</span>
            <span class="campaign-status ${c.status}">${c.status}</span>
          </div>
          <div class="campaign-card-subject">${escapeHtml(c.subject || "(no subject)")}</div>
          <div class="campaign-card-stats">
            <span>📤 ${s.total_sent || 0} sent</span>
            <span>📬 ${openRate}% opened</span>
            <span>🔴 ${s.bounced || 0} bounced</span>
          </div>
          <div class="campaign-card-actions">
            <button class="btn-secondary btn-sm" onclick="event.stopPropagation(); duplicateCampaign('${c.id}')">📋 Duplicate</button>
            <button class="btn-danger btn-sm" onclick="event.stopPropagation(); deleteCampaignUI('${c.id}')">🗑 Delete</button>
          </div>
        </div>`;
    }).join("");
    // Click to open editor
    container.querySelectorAll(".campaign-card").forEach(card => {
      card.addEventListener("click", () => openCampaignEditor(card.dataset.id));
    });
  } catch { toast("Failed to load campaigns", "error"); }
}

async function openCampaignEditor(id) {
  if (id) {
    try {
      const res = await api(`/campaigns/${id}`);
      const data = await res.json();
      const c = data.campaign;
      currentCampaignId = c.id;
      document.getElementById("campaign-name").value = c.name;
      document.getElementById("campaign-subject").value = c.subject;
      document.getElementById("campaign-rich-editor").innerHTML = sanitizeEditorHtml(c.body_html || "");
      document.getElementById("campaign-html-source").value = c.body_html || "";
      document.getElementById("campaign-text").value = c.body_text || "";
      document.getElementById("campaign-tag-filter").value = c.tag_filter || "";

      // Disable editing while a campaign is locked for sending
      const isLocked = c.status === "sent" || c.status === "sending";
      document.getElementById("campaign-save").style.display = isLocked ? "none" : "";
      document.getElementById("campaign-send-btn").style.display = isLocked ? "none" : "";
      document.getElementById("campaign-rich-editor").contentEditable = !isLocked;

      // Show stats for sent campaigns
      const statsBar = document.getElementById("campaign-sent-stats");
      if ((c.status === "sent" || c.status === "sending") && data.stats) {
        const s = data.stats;
        const openRate = s.delivered ? ((s.opened / s.delivered) * 100).toFixed(1) : "0.0";
        const clickRate = s.delivered ? ((s.clicked / s.delivered) * 100).toFixed(1) : "0.0";
        const bounceRate = s.total_sent ? ((s.bounced / s.total_sent) * 100).toFixed(1) : "0.0";
        statsBar.innerHTML = `
          <div class="cs-item"><span class="cs-value">${s.total_sent}</span><span class="cs-label">Sent</span></div>
          <div class="cs-item"><span class="cs-value">${s.delivered}</span><span class="cs-label">Delivered</span></div>
          <div class="cs-item"><span class="cs-value" style="color:var(--green)">${openRate}%</span><span class="cs-label">Opened</span></div>
          <div class="cs-item"><span class="cs-value" style="color:var(--blue)">${clickRate}%</span><span class="cs-label">Clicked</span></div>
          <div class="cs-item"><span class="cs-value" style="color:var(--red)">${bounceRate}%</span><span class="cs-label">Bounced</span></div>
        `;
        statsBar.classList.remove("hidden");
      } else {
        statsBar.classList.add("hidden");
      }
    } catch { toast("Failed to load campaign", "error"); return; }
  } else {
    // New campaign
    currentCampaignId = null;
    document.getElementById("campaign-name").value = "";
    document.getElementById("campaign-subject").value = "";
    document.getElementById("campaign-rich-editor").innerHTML = "";
    document.getElementById("campaign-html-source").value = "";
    document.getElementById("campaign-text").value = "";
    document.getElementById("campaign-tag-filter").value = "";
    document.getElementById("campaign-save").style.display = "";
    document.getElementById("campaign-send-btn").style.display = "";
    document.getElementById("campaign-rich-editor").contentEditable = true;
    document.getElementById("campaign-sent-stats").classList.add("hidden");
  }
  document.getElementById("campaign-list-view").classList.add("hidden");
  document.getElementById("campaign-editor-view").classList.remove("hidden");
  updateCampaignPreview();
}

async function saveCampaign() {
  const name = document.getElementById("campaign-name").value.trim();
  if (!name) { toast("Campaign name is required", "error"); return; }
  const bodyHtml = campaignSourceMode
    ? document.getElementById("campaign-html-source").value
    : document.getElementById("campaign-rich-editor").innerHTML;
  const payload = {
    name,
    subject: document.getElementById("campaign-subject").value,
    body_html: bodyHtml,
    body_text: document.getElementById("campaign-text").value,
    tag_filter: document.getElementById("campaign-tag-filter").value || null,
  };
  try {
    let res;
    if (currentCampaignId) {
      res = await api(`/campaigns/${currentCampaignId}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      res = await api("/campaigns", { method: "POST", body: JSON.stringify(payload) });
    }
    const data = await res.json();
    if (data.success || data.campaign) {
      currentCampaignId = data.campaign.id;
      toast("Campaign saved");
    } else {
      toast(data.error || "Failed to save", "error");
    }
  } catch { toast("Failed to save campaign", "error"); }
}

async function duplicateCampaign(id) {
  try {
    const res = await api(`/campaigns/${id}/duplicate`, { method: "POST" });
    const data = await res.json();
    if (data.success) {
      toast("Campaign duplicated");
      loadCampaignList();
    }
  } catch { toast("Failed to duplicate", "error"); }
}

async function deleteCampaignUI(id) {
  if (!confirm("Delete this campaign?")) return;
  try {
    await api(`/campaigns/${id}`, { method: "DELETE" });
    toast("Campaign deleted");
    loadCampaignList();
  } catch { toast("Failed to delete", "error"); }
}

async function updateCampaignPreview() {
  if (!currentCampaignId) return;
  try {
    await saveCampaign();
    const res = await api(`/campaigns/${currentCampaignId}/preview`, { method: "POST" });
    const html = await res.text();
    const preview = document.getElementById("campaign-preview");
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "");
    frame.srcdoc = html;
    preview.replaceChildren(frame);
  } catch {}
}

// Campaign editor toolbar
function initCampaignToolbar() {
  const toolbar = document.getElementById("campaign-rich-toolbar");
  const editor = document.getElementById("campaign-rich-editor");
  if (!toolbar || !editor) return;

  toolbar.querySelectorAll("button[data-cmd]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      editor.focus();
      const cmd = btn.dataset.cmd;
      const val = btn.dataset.val || null;
      if (cmd === "createLink") {
        const url = prompt("Enter URL:");
        if (url) document.execCommand(cmd, false, url);
      } else if (cmd === "formatBlock" && val) {
        document.execCommand(cmd, false, `<${val}>`);
      } else {
        document.execCommand(cmd, false, val);
      }
    });
  });

  // Source toggle
  const sourceToggle = document.getElementById("campaign-source-toggle");
  const source = document.getElementById("campaign-html-source");
  sourceToggle?.addEventListener("click", () => {
    campaignSourceMode = !campaignSourceMode;
    if (campaignSourceMode) {
      source.value = editor.innerHTML;
      editor.style.display = "none";
      source.style.display = "";
      sourceToggle.classList.add("active");
    } else {
      editor.innerHTML = sanitizeEditorHtml(source.value);
      editor.style.display = "";
      source.style.display = "none";
      sourceToggle.classList.remove("active");
    }
  });

  // Auto-sync plain text
  let syncTimeout;
  editor.addEventListener("input", () => {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      const text = editor.innerText || editor.textContent || "";
      document.getElementById("campaign-text").value = text.replace(/\n{3,}/g, "\n\n").trim();
    }, 400);
  });

  editor.addEventListener("paste", (event) => {
    event.preventDefault();
    const html = event.clipboardData?.getData("text/html");
    const text = event.clipboardData?.getData("text/plain") || "";

    if (html) {
      document.execCommand("insertHTML", false, sanitizeEditorHtml(html));
      return;
    }

    document.execCommand("insertText", false, text);
  });
}

// Campaign event listeners
document.getElementById("create-campaign-btn")?.addEventListener("click", () => openCampaignEditor(null));
document.getElementById("campaign-back")?.addEventListener("click", () => loadCampaignList());
document.getElementById("campaign-save")?.addEventListener("click", saveCampaign);

document.getElementById("campaign-test-btn")?.addEventListener("click", async () => {
  if (!currentCampaignId) { toast("Save campaign first", "error"); return; }
  await saveCampaign();
  document.getElementById("campaign-test-modal").classList.remove("hidden");
});

document.getElementById("campaign-test-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("campaign-test-email").value;
  try {
    const res = await api(`/campaigns/${currentCampaignId}/test-send`, {
      method: "POST", body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (data.success) { toast(`Test sent to ${email}`); document.getElementById("campaign-test-modal").classList.add("hidden"); }
    else toast(data.error || "Failed", "error");
  } catch { toast("Test send failed", "error"); }
});

document.getElementById("campaign-send-btn")?.addEventListener("click", async () => {
  if (!currentCampaignId) { toast("Save campaign first", "error"); return; }
  await saveCampaign();
  document.getElementById("campaign-send-modal").classList.remove("hidden");
});

document.getElementById("confirm-campaign-send")?.addEventListener("click", async () => {
  document.getElementById("campaign-send-modal").classList.add("hidden");
  try {
    const res = await api(`/campaigns/${currentCampaignId}/send`, { method: "POST" });
    const data = await res.json();
    if (!data.success) {
      toast(data.error || "Send failed", "error");
      return;
    }

    // Show drip info
    const drip = data.drip || {};
    const warmupLabel = drip.isWarmingUp ? ` (Warmup Day ${drip.warmupDay})` : "";
    toast(`📨 Campaign queued${warmupLabel} — ${drip.chunkSize}/chunk, ${drip.intervalMinutes}min interval`);

    // Poll for drip progress
    let currentJobId = data.jobId;
    const pollInterval = setInterval(async () => {
      try {
        const jobRes = await api(`/jobs/${currentJobId}`);
        const job = await jobRes.json();

        if (job.status === "completed") {
          const r = job.result || {};

          if (r.status === "dripping" && r.remaining > 0) {
            // Chunk done, more to come — find the next job
            toast(`📤 Chunk ${r.chunkIndex}: +${r.sent} sent (${r.totalSent} total), ${r.remaining} remaining — next in ${drip.intervalMinutes}min`);

            // Poll for the next chunk job
            const jobsRes = await api("/jobs?status=pending");
            const jobsData = await jobsRes.json();
            const nextJob = (jobsData.jobs || []).find(j =>
              j.type === "campaign_send" && JSON.parse(j.payload || "{}").campaignId === currentCampaignId
            );
            if (nextJob) {
              currentJobId = nextJob.id;
            }
            // Keep polling with same interval
          } else {
            // All chunks complete
            clearInterval(pollInterval);
            toast(`✅ Campaign complete! ${r.totalSent || 0} sent, ${r.totalFailed || 0} failed (${r.chunkIndex || 1} chunks)`);
            openCampaignEditor(currentCampaignId);
          }
        } else if (job.status === "failed") {
          clearInterval(pollInterval);
          toast(`❌ Campaign send failed: ${job.error || "Unknown error"}`, "error");
          openCampaignEditor(currentCampaignId);
        }
        // still 'pending' or 'running' — keep polling
      } catch {
        clearInterval(pollInterval);
        toast("Lost connection while tracking send", "error");
      }
    }, 3000);
  } catch { toast("Campaign send failed", "error"); }
});

initCampaignToolbar();

// Merge tag click-to-insert
document.querySelectorAll(".merge-tag-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tag = btn.dataset.tag;
    const editor = document.getElementById("campaign-rich-editor");
    editor.focus();
    document.execCommand("insertText", false, tag);
  });
});

// ── Init ─────────────────────────────────
(async () => {
  try {
    const res = await api("/me");
    if (res.ok) {
      showApp();
      navigateTo("dashboard");
    }
  } catch {
    // Leave the login screen visible for unauthenticated sessions.
  }
})();
