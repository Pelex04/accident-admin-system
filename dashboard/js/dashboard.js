requireAuthOrRedirect();
renderSidebar("overview");

const STALE_CRITICAL_HOURS = 48;

function timeAgo(iso) {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + "h ago";
  return Math.round(hours / 24) + "d ago";
}

function severityOf(alert) {
  if (alert.type === "crash_alert_failed") return "critical";
  if (alert.type === "stale_heartbeat") {
    const hours = alert.at ? (Date.now() - new Date(alert.at).getTime()) / 36e5 : Infinity;
    return hours > STALE_CRITICAL_HOURS ? "critical" : "warning";
  }
  if (alert.type === "low_balance") return "warning";
  return "info";
}

function alertMessage(alert) {
  if (alert.type === "stale_heartbeat") {
    return esc(alert.vehicleName) + " is offline, last check in " + timeAgo(alert.at);
  }
  return esc(alert.message);
}

function kpi(label, value, hint, tone) {
  return '<div class="kpi ' + (tone || "") + '"><div class="label">' + label + '</div><div class="value">' + value +
    '</div><div class="hint">' + hint + "</div></div>";
}

async function loadOverview() {
  const [vehicles, alerts, events] = await Promise.all([
    api.getVehicles().catch(() => null),
    api.getAlerts().catch(() => null),
    api.getEvents().catch(() => null)
  ]);
  const v = vehicles || [], a = alerts || [], e = events || [];

  const attention = a.filter((x) => severityOf(x) !== "info");
  const critical = attention.filter((x) => severityOf(x) === "critical").length;
  const last24h = e.filter((x) => Date.now() - new Date(x.detectedAt).getTime() < 864e5).length;
  const sent = e.filter((x) => x.status === "alert_sent").length;
  const failed = e.filter((x) => x.status === "alert_failed").length;

  document.getElementById("kpis").innerHTML =
    kpi("Vehicles", v.length, v.filter((x) => x.status === "active").length + " active", "") +
    kpi("Crashes in the last 24 hours", last24h, e.length + " logged overall", last24h ? "danger" : "ok") +
    kpi("Needs attention", attention.length, critical ? critical + " critical" : attention.length ? "Warnings only" : "All clear", critical ? "danger" : attention.length ? "warn" : "ok") +
    kpi("Alert delivery", sent + failed ? Math.round((sent / (sent + failed)) * 100) + "%" : "n/a", sent + " sent, " + failed + " failed", failed ? "warn" : "ok");

  const box = document.getElementById("alertsContainer");
  if (!alerts) {
    box.innerHTML = '<div class="empty-state">Could not load alerts.</div>';
  } else if (!attention.length) {
    box.innerHTML = '<div class="empty-state">Nothing needs attention. Every device is checking in normally.</div>';
  } else {
    const order = { critical: 0, warning: 1 };
    attention.sort((x, y) => order[severityOf(x)] - order[severityOf(y)] || new Date(y.at) - new Date(x.at));
    box.innerHTML =
      '<div class="attn-list">' +
      attention.slice(0, 8).map((x) => {
        const sev = severityOf(x);
        return '<div class="attn-row ' + sev + '"><span class="badge ' + (sev === "critical" ? "danger" : "warn") + '">' +
          (sev === "critical" ? "Critical" : "Warning") + '</span><span class="msg">' + alertMessage(x) + "</span>" +
          '<span class="when">' + timeAgo(x.at) + "</span>" +
          (x.vehicleId ? '<a href="vehicle.html?id=' + esc(x.vehicleId) + '">View</a>' : "") + "</div>";
      }).join("") + "</div>" +
      (attention.length > 8 ? '<div class="muted" style="margin-top:8px">' + (attention.length - 8) + " more not shown</div>" : "");
  }

  const body = document.getElementById("eventsTableBody");
  if (!events) {
    body.innerHTML = '<tr class="empty-row"><td colspan="4">Could not load events.</td></tr>';
  } else if (!e.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="4">No crash events recorded yet.</td></tr>';
  } else {
    body.innerHTML = e.slice(0, 10).map((ev) => {
      const veh = v.find((x) => x.id === ev.vehicleId);
      const hasLoc = ev.latitude !== null && ev.longitude !== null && ev.latitude !== undefined;
      return "<tr><td>" + esc(veh ? veh.name : "Unknown vehicle") + '</td><td class="mono"><a href="event.html?id=' + esc(ev.id) + '">' +
        new Date(ev.detectedAt).toLocaleString() + "</a></td><td>" + statusBadge(ev.status) + '</td><td class="mono">' +
        (hasLoc ? esc(ev.latitude + ", " + ev.longitude) : "\u2014") + "</td></tr>";
    }).join("");
  }
}

loadOverview();
window.onLiveUpdate = loadOverview;
