requireAuthOrRedirect();
renderSidebar("events");

const byId = (id) => document.getElementById(id);
const eventId = new URLSearchParams(window.location.search).get("id");
const STATUSES = ["detected", "countdown", "cancelled", "alert_sent", "alert_failed"];
let miniMap = null;

function ago(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + " minutes ago";
  const hours = Math.round(minutes / 60);
  return hours < 24 ? hours + " hours ago" : Math.round(hours / 24) + " days ago";
}

async function loadEvent() {
  const root = byId("eventRoot");
  if (!eventId) {
    root.innerHTML = '<div class="empty-state">No event selected. <a href="events.html">Back to crash events</a></div>';
    return;
  }
  try {
    const event = await api.getEvent(eventId);
    const [vehicle, contacts, history] = await Promise.all([
      api.getVehicle(event.vehicleId).catch(() => null),
      api.getVehicleContacts(event.vehicleId).catch(() => []),
      api.getEvents({ vehicleId: event.vehicleId }).catch(() => [])
    ]);
    const name = vehicle ? vehicle.name : "Unknown vehicle";
    const lat = Number(event.latitude), lon = Number(event.longitude);
    const hasLoc = event.latitude !== null && event.longitude !== null && isFinite(lat) && isFinite(lon);
    const idx = { detected: 0, countdown: 1 }[event.status];
    const final = idx === undefined;

    byId("eTitle").textContent = "Crash: " + name;
    byId("eSub").textContent = "Detected " + new Date(event.detectedAt).toLocaleString() + " (" + ago(event.detectedAt) + ")";

    if (miniMap) { miniMap.remove(); miniMap = null; }
    root.innerHTML =
      '<ul class="stepper"><li class="' + (idx === 0 ? "current" : "done") + '">Detected</li>' +
      '<li class="' + (idx === 1 ? "current" : final ? "done" : "") + '">Countdown</li>' +
      '<li class="' + (final ? "current" + (event.status === "alert_failed" ? " bad" : "") : "") + '">' +
      (final ? event.status.replace(/_/g, " ") : "Outcome pending") + "</li></ul>" +
      '<div class="detail-grid"><div class="card"><h2>Details</h2><dl class="facts">' +
      "<dt>Vehicle</dt><dd>" + (vehicle ? '<a href="vehicle.html?id=' + esc(vehicle.id) + '">' + esc(name) + "</a>" : esc(name)) + "</dd>" +
      "<dt>Status</dt><dd><select id=\"statusSelect\">" +
      STATUSES.map((s) => '<option value="' + s + '"' + (s === event.status ? " selected" : "") + ">" + s.replace(/_/g, " ") + "</option>").join("") +
      "</select></dd>" +
      "<dt>Cancelled by</dt><dd>" + esc(event.cancelledBy || "\u2014") + "</dd>" +
      "<dt>Location</dt><dd class=\"mono\">" + (hasLoc ? '<a target="_blank" rel="noopener" href="https://maps.google.com/?q=' + lat + "," + lon + '">' + lat + ", " + lon + "</a>" : "No location reported") + "</dd>" +
      "<dt>Notes</dt><dd><textarea id=\"notesInput\" placeholder=\"Add notes\">" + esc(event.notes) + "</textarea>" +
      '<div style="margin-top:8px"><button type="button" class="btn" id="saveNotes">Save notes</button></div></dd></dl></div>' +
      '<div class="card"><h2>Location</h2>' + (hasLoc ? '<div id="miniMap" class="map-mini" style="margin-top:0"></div>' : '<div class="empty-state">This crash was reported without coordinates.</div>') + "</div></div>" +
      '<div class="detail-grid"><div class="section"><div class="section-title"><h2>Emergency contacts for ' + esc(name) + "</h2></div>" +
      '<table class="data-table"><thead><tr><th>Name</th><th>Phone number</th><th>Priority</th></tr></thead><tbody>' +
      (contacts.length ? contacts.map((c) => "<tr><td>" + esc(c.name) + '</td><td class="mono">' + esc(c.phoneNumber) + "</td><td>" + esc(c.priority) + "</td></tr>").join("") : '<tr class="empty-row"><td colspan="3">No contacts on file.</td></tr>') +
      "</tbody></table></div>" +
      '<div class="section"><div class="section-title"><h2>Other crashes for this vehicle</h2></div>' +
      '<table class="data-table"><thead><tr><th>Detected</th><th>Status</th></tr></thead><tbody>' +
      (history.filter((h) => h.id !== event.id).slice(0, 5).map((h) => '<tr><td class="mono"><a href="event.html?id=' + esc(h.id) + '">' + new Date(h.detectedAt).toLocaleString() + "</a></td><td>" + statusBadge(h.status) + "</td></tr>").join("") || '<tr class="empty-row"><td colspan="2">No other crashes.</td></tr>') +
      "</tbody></table></div></div>";

    if (hasLoc && typeof L !== "undefined") {
      miniMap = L.map("miniMap").setView([lat, lon], 15);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(miniMap);
      L.circleMarker([lat, lon], { radius: 10, color: "#fff", weight: 2, fillColor: "#e5484d", fillOpacity: 0.95 }).addTo(miniMap);
    }

    byId("statusSelect").addEventListener("change", async (e) => {
      try { await api.updateEvent(event.id, { status: e.target.value }); toast("Status updated", "ok"); loadEvent(); }
      catch (err) { toast(err.message, "danger"); }
    });
    byId("saveNotes").addEventListener("click", async () => {
      try { await api.updateEvent(event.id, { notes: byId("notesInput").value }); toast("Notes saved", "ok"); }
      catch (err) { toast(err.message, "danger"); }
    });
  } catch (err) {
    root.innerHTML = '<div class="empty-state">Could not load this event: ' + esc(err.message) + ' <a href="events.html">Back to crash events</a></div>';
  }
}

loadEvent();
window.onLiveUpdate = loadEvent;
