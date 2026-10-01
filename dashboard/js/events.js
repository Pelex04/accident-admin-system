requireAuthOrRedirect();
renderSidebar("events");

function mapLink(latitude, longitude) {
  if (latitude === null || longitude === null || latitude === undefined || longitude === undefined) {
    return "\u2014";
  }
  const lat = Number(latitude), lon = Number(longitude);
  return '<a href="https://maps.google.com/?q=' + esc(lat) + "," + esc(lon) + '" target="_blank" rel="noopener">' + esc(lat) + ", " + esc(lon) + "</a>";
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
      tableBody.innerHTML = '<tr class="empty-row"><td colspan="6">No crash events match this filter.</td></tr>';
      return;
    }

    tableBody.innerHTML = events
      .map((event) => {
        const vehicle = vehicles.find((v) => v.id === event.vehicleId);
        const vehicleName = vehicle ? vehicle.name : "Unknown vehicle";
        const id = esc(event.id), at = esc(event.detectedAt);

        return (
          '<tr data-id="' + id + '" data-ts="' + at + '">' +
          '<td><span class="dot ' + dotForStatus(event.status) + '"></span>' + esc(vehicleName) + "</td>" +
          '<td class="mono" data-v="' + at + '"><a href="event.html?id=' + id + '">' + esc(new Date(event.detectedAt).toLocaleString()) + "</a></td>" +
          "<td>" + esc(event.status.replace(/_/g, " ")) + "</td>" +
          '<td class="mono">' + mapLink(event.latitude, event.longitude) + "</td>" +
          '<td class="muted">' + esc(event.notes || "\u2014") + "</td>" +
          '<td><select data-event-id="' + id + '">' +
          ["detected", "countdown", "cancelled", "alert_sent", "alert_failed"]
            .map((status) => '<option value="' + status + '"' + (status === event.status ? " selected" : "") + ">" + status.replace(/_/g, " ") + "</option>")
            .join("") +
          "</select></td></tr>"
        );
      })
      .join("");

    document.querySelectorAll("[data-event-id]").forEach((select) => {
      select.addEventListener("change", async () => {
        try {
          await api.updateEvent(select.dataset.eventId, { status: select.value });
          toast("Status updated", "ok");
        } catch (err) {
          toast(err.message, "danger");
        }
        loadEvents();
      });
    });
  } catch (err) {
    tableBody.innerHTML = '<tr class="empty-row"><td colspan="6">Could not load events: ' + esc(err.message) + "</td></tr>";
  }
}

document.getElementById("statusFilter").addEventListener("change", loadEvents);

loadEvents();

window.onLiveUpdate = loadEvents;
