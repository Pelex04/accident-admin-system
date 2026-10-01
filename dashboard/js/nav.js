const NAV_ITEMS = [
  { key: "overview", label: "Overview", href: "index.html" },
  { key: "vehicles", label: "Vehicles", href: "vehicles.html" },
  { key: "events", label: "Crash events", href: "events.html" },
  { key: "map", label: "Crash map", href: "map.html" },
  { key: "sim", label: "SIM status", href: "sim.html" },
  { key: "reports", label: "Reports", href: "reports.html" }
];

const SUPER_ITEMS = [
  { key: "admins", label: "Admins", href: "admins.html" },
  { key: "audit", label: "Audit log", href: "audit.html" }
];

window.addEventListener("unhandledrejection", (event) => {
  const message = event.reason && event.reason.message;
  if (message && message !== "Not authenticated" && message !== "Password change required") toast(message, "danger");
});

const LOGO_MARK =
  '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#1c7ed6"/>' +
  '<path d="M5 17h6l2.5-9 4 16 2.5-7H27" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function statusBadge(status) {
  const tones = { alert_failed: "danger", detected: "warn", countdown: "warn", alert_sent: "ok", cancelled: "neutral" };
  if (!tones[status]) return '<span class="badge neutral">unknown</span>';
  return '<span class="badge ' + tones[status] + '">' + status.replace(/_/g, " ") + "</span>";
}

function toast(message, kind, action) {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    box.className = "toasts";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.className = "toast " + (kind || "info");
  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(text);
  if (action) {
    const link = document.createElement("a");
    link.href = action.href;
    link.textContent = action.label;
    el.appendChild(link);
  }
  el.addEventListener("click", (e) => { if (e.target.tagName !== "A") el.remove(); });
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === "danger" ? 9000 : 4500);
}

function confirmDialog(message, okLabel) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "modal-scrim";
    scrim.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true"><p></p><div class="modal-actions">' +
      '<button type="button" class="btn secondary" data-r="0">Cancel</button>' +
      '<button type="button" class="btn danger" data-r="1"></button></div></div>';
    scrim.querySelector("p").textContent = message;
    scrim.querySelector('[data-r="1"]').textContent = okLabel || "Confirm";
    const close = (result) => { document.removeEventListener("keydown", onKey); scrim.remove(); resolve(result); };
    const onKey = (e) => { if (e.key === "Escape") close(false); };
    scrim.addEventListener("click", (e) => {
      if (e.target === scrim) close(false);
      const r = e.target.getAttribute && e.target.getAttribute("data-r");
      if (r !== null && r !== undefined) close(r === "1");
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(scrim);
    scrim.querySelector('[data-r="0"]').focus();
  });
}

function renderSidebar(activePage) {
  const role = localStorage.getItem("adminRole") || "viewer";
  document.body.classList.add("role-" + role);
  const linksHtml = NAV_ITEMS.concat(role === "super_admin" ? SUPER_ITEMS : []).map(
    (item) => '<a href="' + item.href + '"' + (item.key === activePage ? ' class="active" aria-current="page"' : "") + ">" + item.label + "</a>"
  ).join("");

  const sidebar = document.createElement("div");
  sidebar.className = "sidebar";
  sidebar.innerHTML =
    '<div class="sidebar-brand">' + LOGO_MARK + '<div><div class="name"><span class="accent">Accident</span> Detection</div><div class="sub">Admin</div></div></div>' +
    "<nav>" + linksHtml + "</nav>" +
    '<div class="sidebar-footer">' +
    '<div class="live"><span class="dot neutral" id="liveDot"></span><span id="liveText">Connecting...</span></div>' +
    '<div class="who"></div><a href="change-password.html">Change password</a><a href="#" id="logoutLink">Log out</a></div>';
  sidebar.querySelector(".who").textContent = (localStorage.getItem("adminEmail") || "Admin") + " (" + role.replace("_", " ") + ")";

  const layout = document.querySelector(".layout");
  layout.insertBefore(sidebar, layout.firstChild);

  const topbar = document.createElement("div");
  topbar.className = "topbar";
  topbar.innerHTML =
    '<button type="button" class="menu-btn" aria-label="Open menu"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>' +
    LOGO_MARK + "<span>Accident Detection Admin</span>";
  const main = document.querySelector(".main");
  main.insertBefore(topbar, main.firstChild);

  const scrim = document.createElement("div");
  scrim.className = "scrim";
  layout.appendChild(scrim);
  const setOpen = (open) => document.body.classList.toggle("nav-open", open);
  topbar.querySelector(".menu-btn").addEventListener("click", () => setOpen(true));
  scrim.addEventListener("click", () => setOpen(false));
  sidebar.querySelectorAll("nav a").forEach((a) => a.addEventListener("click", () => setOpen(false)));

  document.getElementById("logoutLink").addEventListener("click", (event) => {
    event.preventDefault();
    clearToken();
    window.location.href = "login.html?reason=signedout";
  });

  startLive();
}

// Polls for crash changes. Pages set window.onLiveUpdate to reload their own data.
function startLive() {
  const KEY = "liveSeen";
  const label = document.getElementById("liveText");
  const dot = document.getElementById("liveDot");
  let busy = false;
  const editing = () => {
    const a = document.activeElement;
    return a && (/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) || a.getAttribute("aria-expanded") === "true") && a.closest(".page-body");
  };

  async function poll() {
    if (document.hidden || busy) return;
    busy = true;
    try {
      const events = await api.getEvents();
      const ids = events.map((e) => e.id);
      const sig = events.map((e) => e.id + ":" + e.status).join("|");
      const seen = JSON.parse(sessionStorage.getItem(KEY) || "null");
      const stored = { ids, sig };
      if (seen) {
        const fresh = events.filter((e) => seen.ids.indexOf(e.id) < 0);
        if (fresh.length) {
          const vehicles = await api.getVehicles().catch(() => []);
          fresh.slice(0, 3).forEach((e) => {
            const v = vehicles.find((x) => x.id === e.vehicleId);
            toast("New crash reported: " + (v ? v.name : "unknown vehicle"), "danger", { href: "event.html?id=" + e.id, label: "View" });
          });
          if (fresh.length > 3) toast(fresh.length - 3 + " more new crashes", "danger", { href: "events.html", label: "View all" });
        }
        if (sig !== seen.sig) {
          if (editing()) stored.sig = seen.sig;
          else if (window.onLiveUpdate) window.onLiveUpdate();
        }
      }
      sessionStorage.setItem(KEY, JSON.stringify(stored));
      label.textContent = "Live, updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      dot.className = "dot ok";
    } catch (err) {
      label.textContent = "Connection lost, retrying";
      dot.className = "dot warn";
    }
    busy = false;
  }

  poll();
  setInterval(poll, 20000);
  document.addEventListener("visibilitychange", poll);
}
