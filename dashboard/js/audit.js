requireAuthOrRedirect();
renderSidebar("audit");

const byId = (id) => document.getElementById(id);

async function loadAudit() {
  const body = byId("auditBody");
  try {
    const rows = await api.getAudit({ limit: 500 });
    body.innerHTML = rows.length
      ? rows
          .map((r) =>
            '<tr data-ts="' + esc(r.at) + '"><td class="mono" data-v="' + esc(r.at) + '">' + esc(new Date(r.at).toLocaleString()) + "</td>" +
            "<td>" + esc(r.adminEmail || "\u2014") + '</td><td class="mono">' + esc(r.action) + "</td>" +
            "<td>" + esc(r.summary || "") + '</td><td class="mono">' + esc(r.ip || "\u2014") + "</td></tr>")
          .join("")
      : '<tr class="empty-row"><td colspan="5">Nothing recorded yet.</td></tr>';
    byId("auditNote").textContent = rows.length >= 500 ? "Showing the latest 500 entries." : "";
  } catch (err) {
    body.innerHTML = '<tr class="empty-row"><td colspan="5">Could not load the audit log: ' + esc(err.message) + "</td></tr>";
  }
}

if (localStorage.getItem("adminRole") !== "super_admin") {
  byId("auditRoot").innerHTML = '<div class="empty-state">Only super admins can read the audit log.</div>';
} else {
  enhanceTable(byId("auditBody").closest("table"), { name: "audit log", dates: true, pageSize: 50 });
  loadAudit();
}
