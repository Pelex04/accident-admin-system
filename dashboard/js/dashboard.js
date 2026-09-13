requireAuthOrRedirect();
renderSidebar("overview");

function badgeForAlertType(type) {
  if (type === "crash_alert_failed") return "danger";
  if (type === "low_balance" || type === "stale_heartbeat") return "warn";
  return "ok";
}

function dotForAlertType(type) {
  if (type === "crash_alert_failed") return "danger";
  if (type === "low_balance" || type === "stale_heartbeat") return "warn";
  return "ok";
}

function timeAgo(isoString) {
  const minutes = Math.round((Date.now() - new Date(isoString).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + "h ago";
  return Math.round(hours / 24) + "d ago";
}

async function loadOverview() {
  const statStrip = document.getElementById("statStrip");
  const alertsContainer = document.getElementById("alertsContainer");
  const eventsTableBody = document.getElementById("eventsTableBody");

  let vehicles = [];
  let alerts = [];
  let events = [];

  try {
    vehicles = await api.getVehicles();
  } catch (err) {
    // handled by stat strip fallback below
  }

  try {
    alerts = await api.getAlerts();
  } catch (err) {
    alertsContainer.innerHTML = "<div class=\"empty-state\">Could not load alerts: " + err.message + "</div>";
  }

  try {
    events = await api.getEvents();
  } catch (err) {
    eventsTableBody.innerHTML = "<tr class=\"empty-row\"><td colspan=\"4\">Could not load events: " + err.message + "</td></tr>";
  }

  const activeVehicles = vehicles.filter((v) => v.status === "active").length;
  const lowBalanceCount = alerts.filter((a) => a.type === "low_balance").length;
  const crashCount = events.length;

  statStrip.innerHTML =
    "<div class=\"stat\"><div class=\"value\">" + vehicles.length + "</div><div class=\"label\">Vehicles</div></div>" +
    "<div class=\"stat\"><div class=\"value brand\">" + activeVehicles + "</div><div class=\"label\">Active</div></div>" +
    "<div class=\"stat\"><div class=\"value " + (lowBalanceCount > 0 ? "warning" : "") + "\">" + lowBalanceCount + "</div><div class=\"label\">Low balance</div></div>" +
    "<div class=\"stat\"><div class=\"value " + (crashCount > 0 ? "danger" : "") + "\">" + crashCount + "</div><div class=\"label\">Crash events logged</div></div>";

  if (!alertsContainer.innerHTML.includes("Could not load")) {
    if (alerts.length === 0) {
      alertsContainer.innerHTML = "<div class=\"empty-state\">No active alerts. Everything is checking in normally.</div>";
    } else {
      alertsContainer.innerHTML =
        "<div class=\"alert-list\">" +
        alerts
          .slice(0, 10)
          .map(
            (alert) =>
              "<div class=\"alert-row\">" +
              "<span class=\"dot " + dotForAlertType(alert.type) + "\"></span>" +
              "<span class=\"msg\">" + alert.message + "</span>" +
              "<span class=\"when\">" + timeAgo(alert.at) + "</span>" +
              "</div>"
          )
          .join("") +
        "</div>";
    }
  }

  if (!eventsTableBody.innerHTML.includes("Could not load")) {
    if (events.length === 0) {
      eventsTableBody.innerHTML = "<tr class=\"empty-row\"><td colspan=\"4\">No crash events recorded yet.</td></tr>";
    } else {
      eventsTableBody.innerHTML = events
        .slice(0, 10)
        .map((event) => {
          const vehicle = vehicles.find((v) => v.id === event.vehicleId);
          const vehicleName = vehicle ? vehicle.name : "Unknown vehicle";
          const location =
            event.latitude !== null && event.longitude !== null
              ? event.latitude + ", " + event.longitude
              : "\u2014";

          return (
            "<tr>" +
            "<td>" + vehicleName + "</td>" +
            "<td class=\"mono\">" + new Date(event.detectedAt).toLocaleString() + "</td>" +
            "<td>" + event.status.replace(/_/g, " ") + "</td>" +
            "<td class=\"mono\">" + location + "</td>" +
            "</tr>"
          );
        })
        .join("");
    }
  }
}

loadOverview();
