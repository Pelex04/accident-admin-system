requireAuthOrRedirect();
renderSidebar("events");

function mapLink(latitude, longitude) {
  if (latitude === null || longitude === null || latitude === undefined || longitude === undefined) {
    return "Not available";
  }
  const url = "https://maps.google.com/?q=" + latitude + "," + longitude;
  return "<a href=\"" + url + "\" target=\"_blank\" style=\"color: #2f81f7\">" + latitude + ", " + longitude + "</a>";
}

function badgeForStatus(status) {
  if (status === "alert_failed") return "danger";
  if (status === "detected" || status === "countdown") return "warn";
  return "ok";
}

async function loadEvents() {
  const tableBody = document.getElementById("eventsTableBody");
  const statusFilter = document.getElementById("statusFilter").value;

  try {
    const [events, vehicles] = await Promise.all([
      api.getEvents(statusFilter ? { status: statusFilter } : {}),
      api.getVehicles()
    ]);

    if (events.length === 0) {
      tableBody.innerHTML = "<tr><td colspan=\"6\" class=\"muted\">No crash events recorded.</td></tr>";
      return;
    }

    tableBody.innerHTML = events
      .map((event) => {
        const vehicle = vehicles.find((v) => v.id === event.vehicleId);
        const vehicleName = vehicle ? vehicle.name : "Unknown vehicle";

        return (
          "<tr>" +
          "<td>" + vehicleName + "</td>" +
          "<td>" + new Date(event.detectedAt).toLocaleString() + "</td>" +
          "<td><span class=\"badge " + badgeForStatus(event.status) + "\">" + event.status.replace(/_/g, " ") + "</span></td>" +
          "<td>" + mapLink(event.latitude, event.longitude) + "</td>" +
          "<td>" + (event.notes || "") + "</td>" +
          "<td>" +
          "<select data-event-id=\"" + event.id + "\">" +
          ["detected", "countdown", "cancelled", "alert_sent", "alert_failed"]
            .map(
              (status) =>
                "<option value=\"" + status + "\"" + (status === event.status ? " selected" : "") + ">" +
                status.replace(/_/g, " ") +
                "</option>"
            )
            .join("") +
          "</select>" +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    document.querySelectorAll("[data-event-id]").forEach((select) => {
      select.addEventListener("change", async () => {
        await api.updateEvent(select.dataset.eventId, { status: select.value });
        loadEvents();
      });
    });
  } catch (err) {
    tableBody.innerHTML = "<tr><td colspan=\"6\" class=\"muted\">Could not load events: " + err.message + "</td></tr>";
  }
}

document.getElementById("statusFilter").addEventListener("change", loadEvents);

loadEvents();
