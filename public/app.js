// ── State ────────────────────────────────
let apiSecret = localStorage.getItem("apiSecret") || "";
let currentPage = "dashboard";
let subscriberPage = 1;
let selectedIds = new Set();

// ── API Helper ───────────────────────────
async function api(path, options = {}) {
  const headers = { "x-api-secret": apiSecret };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`/api/admin${path}`, { ...options, headers: { ...headers, ...options.headers } });
  if (res.status === 401) { logout(); throw new Error("Unauthorized"); }
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
async function tryLogin(secret) {
  apiSecret = secret;
  try {
    const res = await api("/me");
    if (!res.ok) throw new Error();
    localStorage.setItem("apiSecret", secret);
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    navigateTo("dashboard");
    return true;
  } catch {
    apiSecret = "";
    return false;
  }
}

function logout() {
  apiSecret = "";
  localStorage.removeItem("apiSecret");
  document.getElementById("app").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("login-secret").value = "";
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
  else if (page === "subscribers") loadSubscribers();
  else if (page === "compose") loadEmailContent();
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
  try {
    const res = await api(`/subscribers?page=${subscriberPage}&limit=50&status=${status}&search=${encodeURIComponent(search)}`);
    const data = await res.json();
    const tbody = document.getElementById("subscribers-body");
    const selectAll = document.getElementById("select-all");
    selectAll.checked = false;

    if (!data.subscribers?.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="center">No subscribers found</td></tr>';
      document.getElementById("pagination").innerHTML = "";
      return;
    }
    tbody.innerHTML = data.subscribers.map((s) => `
      <tr>
        <td><input type="checkbox" class="row-select" data-id="${s.id}"></td>
        <td>${escapeHtml(s.email)}</td>
        <td>${escapeHtml(s.name || "—")}</td>
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

// ── CSV Template Download ────────────────
document.getElementById("download-template")?.addEventListener("click", () => {
  const template = "email,name\njohn@example.com,John Doe\njane@example.com,Jane Smith\n";
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
  try {
    const res = await api("/subscribers/upload", { method: "POST", body: formData });
    const data = await res.json();
    if (data.success) {
      document.getElementById("upload-result").classList.remove("hidden");
      document.getElementById("upload-result").innerHTML =
        `<p style="color: var(--green)">✅ Imported: ${data.imported}, Skipped: ${data.skipped}</p>`;
      toast(`Imported ${data.imported} subscribers`);
      loadSubscribers();
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
  fetch(url, { headers: { "x-api-secret": apiSecret } })
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

// ── Email Compose ────────────────────────
async function loadEmailContent() {
  try {
    const res = await api("/email-content");
    const data = await res.json();
    document.getElementById("email-subject").value = data.subject || "";
    document.getElementById("email-html").value = data.bodyHtml || "";
    document.getElementById("email-text").value = data.bodyText || "";
    updatePreview();
  } catch { toast("Failed to load email content", "error"); }
}

function updatePreview() {
  const subject = document.getElementById("email-subject").value;
  const html = document.getElementById("email-html").value;
  const previewContainer = document.getElementById("email-preview");
  const previewHtml = `<!DOCTYPE html><html><head><style>
    body { font-family: -apple-system, sans-serif; padding: 24px; margin: 0; color: #333; font-size: 14px; line-height: 1.6; }
    h2 { color: #1a365d; margin-top: 0; }
  </style></head><body><h2>${escapeHtml(subject)}</h2><hr style="border:none;border-top:1px solid #eee;margin:16px 0">${html}</body></html>`;
  let iframe = previewContainer.querySelector("iframe");
  if (!iframe) { iframe = document.createElement("iframe"); previewContainer.innerHTML = ""; previewContainer.appendChild(iframe); }
  iframe.srcdoc = previewHtml;
}

// Full email preview (with header/footer/unsubscribe)
document.getElementById("full-preview-btn")?.addEventListener("click", async () => {
  // Save first, then fetch the server-rendered full template
  const content = {
    subject: document.getElementById("email-subject").value,
    bodyHtml: document.getElementById("email-html").value,
    bodyText: document.getElementById("email-text").value,
  };
  await api("/email-content", { method: "PUT", body: JSON.stringify(content) });
  const res = await api("/email-preview");
  const html = await res.text();
  const previewContainer = document.getElementById("email-preview");
  let iframe = previewContainer.querySelector("iframe");
  if (!iframe) { iframe = document.createElement("iframe"); previewContainer.innerHTML = ""; previewContainer.appendChild(iframe); }
  iframe.srcdoc = html;
  toast("Showing full email preview with template");
});

document.getElementById("save-email")?.addEventListener("click", async () => {
  const content = {
    subject: document.getElementById("email-subject").value,
    bodyHtml: document.getElementById("email-html").value,
    bodyText: document.getElementById("email-text").value,
  };
  try {
    const res = await api("/email-content", { method: "PUT", body: JSON.stringify(content) });
    if (res.ok) toast("Email content saved!");
    else toast("Failed to save", "error");
  } catch { toast("Failed to save", "error"); }
});

// Test Send
document.getElementById("test-send-btn")?.addEventListener("click", () => openModal("test-modal"));

document.getElementById("test-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("test-email").value;
  // Save content first
  const content = {
    subject: document.getElementById("email-subject").value,
    bodyHtml: document.getElementById("email-html").value,
    bodyText: document.getElementById("email-text").value,
  };
  await api("/email-content", { method: "PUT", body: JSON.stringify(content) });
  try {
    const res = await api("/test-send", { method: "POST", body: JSON.stringify({ email }) });
    const data = await res.json();
    if (data.success) {
      toast(`Test email sent to ${email}!`);
      closeModal("test-modal");
    } else { toast(data.error || "Test send failed", "error"); }
  } catch { toast("Test send failed", "error"); }
});

// Send Now
document.getElementById("send-email")?.addEventListener("click", () => openModal("send-modal"));

document.getElementById("confirm-send")?.addEventListener("click", async () => {
  closeModal("send-modal");
  const content = {
    subject: document.getElementById("email-subject").value,
    bodyHtml: document.getElementById("email-html").value,
    bodyText: document.getElementById("email-text").value,
  };
  try {
    await api("/email-content", { method: "PUT", body: JSON.stringify(content) });
    const res = await api("/send-now", { method: "POST" });
    const data = await res.json();
    if (data.success) toast("🚀 Send triggered successfully!");
    else toast(data.error || "Send failed", "error");
  } catch { toast("Send failed", "error"); }
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
document.getElementById("logout-btn")?.addEventListener("click", logout);
document.getElementById("refresh-stats")?.addEventListener("click", loadDashboard);

let searchTimeout;
document.getElementById("search-input")?.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => { subscriberPage = 1; loadSubscribers(); }, 300);
});
document.getElementById("status-filter")?.addEventListener("change", () => { subscriberPage = 1; loadSubscribers(); });
document.getElementById("email-subject")?.addEventListener("input", updatePreview);
document.getElementById("email-html")?.addEventListener("input", updatePreview);

// ── Init ─────────────────────────────────
(async () => {
  if (apiSecret) {
    const ok = await tryLogin(apiSecret);
    if (!ok) logout();
  }
})();
