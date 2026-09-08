requireAuthOrRedirect();
renderSidebar("overview");

function badgeForAlertType(type) {
  if (type === "crash_alert_failed") return "danger";
  if (type === "low_balance" || type === "stale_heartbeat") return "warn";
  return "ok";
}

async function loadOverview() {
  const alertsContainer = document.getElementById("alertsContainer");
  const vehicleCountContainer = document.getElementById("vehicleCountContainer");
  const eventsTableBody = document.getElementById("eventsTableBody");

  try {
    const alerts = await api.getAlerts();

    if (alerts.length === 0) {
      alertsContainer.textContent = "No active alerts.";
    } else {
      alertsContainer.innerHTML = alerts
        .slice(0, 10)
        .map(
          (alert) =>
            "<div style=\"margin-bottom: 8px\"><span class=\"badge " +
            badgeForAlertType(alert.type) +
            "\">" +
            alert.type.replace(/_/g, " ") +
            "</span> " +
            alert.message +
            "</div>"
        )
        .join("");
    }
  } catch (err) {
    alertsContainer.textContent = "Could not load alerts: " + err.message;
  }

  try {
    const vehicles = await api.getVehicles();
    const activeCount = vehicles.filter((v) => v.status === "active").length;
    vehicleCountContainer.textContent =
      vehicles.length + " total vehicle(s), " + activeCount + " active";
  } catch (err) {
    vehicleCountContainer.textContent = "Could not load vehicles: " + err.message;
  }

  try {
    const events = await api.getEvents();
    const vehicles = await api.getVehicles();

    eventsTableBody.innerHTML = events
      .slice(0, 10)
      .map((event) => {
        const vehicle = vehicles.find((v) => v.id === event.vehicleId);
        const vehicleName = vehicle ? vehicle.name : "Unknown vehicle";
        const location =
          event.latitude !== null && event.longitude !== null
            ? event.latitude + ", " + event.longitude
            : "Not available";

        return (
          "<tr>" +
          "<td>" + vehicleName + "</td>" +
          "<td>" + new Date(event.detectedAt).toLocaleString() + "</td>" +
          "<td>" + event.status.replace(/_/g, " ") + "</td>" +
          "<td>" + location + "</td>" +
          "</tr>"
        );
      })
      .join("");

    if (events.length === 0) {
      eventsTableBody.innerHTML = "<tr><td colspan=\"4\" class=\"muted\">No crash events recorded yet.</td></tr>";
    }
  } catch (err) {
    eventsTableBody.innerHTML =
      "<tr><td colspan=\"4\" class=\"muted\">Could not load events: " + err.message + "</td></tr>";
  }
}

loadOverview();
