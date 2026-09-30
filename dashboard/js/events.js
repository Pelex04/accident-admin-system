requireAuthOrRedirect();
renderSidebar("events");

function mapLink(latitude, longitude) {
  if (latitude === null || longitude === null || latitude === undefined || longitude === undefined) {
    return "\u2014";
  }
  const url = "https://maps.google.com/?q=" + latitude + "," + longitude;
  return "<a href=\"" + url + "\" target=\"_blank\">" + latitude + ", " + longitude + "</a>";
}

function dotForStatus(status) {
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
      tableBody.innerHTML = "<tr class=\"empty-row\"><td colspan=\"6\">No crash events match this filter.</td></tr>";
      return;
    }

    tableBody.innerHTML = events
      .map((event) => {
        const vehicle = vehicles.find((v) => v.id === event.vehicleId);
        const vehicleName = vehicle ? vehicle.name : "Unknown vehicle";

        return (
          "<tr data-id=\"" + event.id + "\" data-ts=\"" + event.detectedAt + "\">" +
          "<td><span class=\"dot " + dotForStatus(event.status) + "\"></span>" + vehicleName + "</td>" +
          "<td class=\"mono\" data-v=\"" + event.detectedAt + "\"><a href=\"event.html?id=" + event.id + "\">" + new Date(event.detectedAt).toLocaleString() + "</a></td>" +
          "<td>" + event.status.replace(/_/g, " ") + "</td>" +
          "<td class=\"mono\">" + mapLink(event.latitude, event.longitude) + "</td>" +
          "<td class=\"muted\">" + (event.notes || "\u2014") + "</td>" +
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
        toast("Status updated", "ok");
        loadEvents();
      });
    });
  } catch (err) {
    tableBody.innerHTML = "<tr class=\"empty-row\"><td colspan=\"6\">Could not load events: " + err.message + "</td></tr>";
  }
}

document.getElementById("statusFilter").addEventListener("change", loadEvents);

loadEvents();

window.onLiveUpdate = loadEvents;
