requireAuthOrRedirect();
renderSidebar("map");

const byId = (id) => document.getElementById(id);
const COLORS = { alert_sent: "#1fae63", cancelled: "#98a2b8", alert_failed: "#e5484d", detected: "#f2a22c", countdown: "#f2a22c" };
let events = [], vehicles = [], map = null, layer = null;

byId("mapLegend").innerHTML = legendHtml([
  { label: "Alert sent", color: COLORS.alert_sent },
  { label: "Cancelled", color: COLORS.cancelled },
  { label: "Alert failed", color: COLORS.alert_failed },
  { label: "Open", color: COLORS.detected }
]);

if (typeof L === "undefined") {
  byId("map").innerHTML = '<div class="empty-state">The map library could not load. Check your connection and reload.</div>';
} else {
  map = L.map("map").setView([-13.25, 34.3], 6);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  layer = L.layerGroup().addTo(map);
}

function draw(fit) {
  if (!map) return;
  const days = byId("rangeSelect").value, vehicleId = byId("vehicleSelect").value, outcome = byId("outcomeSelect").value;
  const since = days === "all" ? 0 : Date.now() - Number(days) * 864e5;
  const open = { detected: 1, countdown: 1 };
  const list = events.filter((e) =>
    new Date(e.detectedAt).getTime() >= since && (!vehicleId || e.vehicleId === vehicleId) &&
    (!outcome || (outcome === "open" ? open[e.status] : e.status === outcome)));

  layer.clearLayers();
  const points = [];
  let missing = 0;
  list.forEach((e) => {
    const lat = Number(e.latitude), lon = Number(e.longitude);
    if (e.latitude === null || e.longitude === null || !isFinite(lat) || !isFinite(lon)) { missing++; return; }
    const v = vehicles.find((x) => x.id === e.vehicleId);
    L.circleMarker([lat, lon], { radius: 9, color: "#fff", weight: 2, fillColor: COLORS[e.status] || COLORS.detected, fillOpacity: 0.95 })
      .bindPopup("<strong>" + esc(v ? v.name : "Unknown vehicle") + "</strong><br>" + esc(new Date(e.detectedAt).toLocaleString()) +
        "<br>" + statusBadge(e.status) + '<br><a href="event.html?id=' + esc(e.id) + '">Open details</a>')
      .addTo(layer);
    points.push([lat, lon]);
  });
  if (fit && points.length) map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
  byId("mapNote").textContent = points.length + (points.length === 1 ? " crash" : " crashes") + " on the map" +
    (missing ? ", " + missing + " without a location" : "") + ".";
}

async function loadMap(fit) {
  try {
    [events, vehicles] = await Promise.all([api.getEvents(), api.getVehicles()]);
    const keep = byId("vehicleSelect").value;
    byId("vehicleSelect").innerHTML = '<option value="">All vehicles</option>' +
      vehicles.map((v) => '<option value="' + esc(v.id) + '">' + esc(v.name) + "</option>").join("");
    byId("vehicleSelect").value = keep;
    draw(fit === true);
  } catch (err) {
    byId("mapNote").textContent = "Could not load crashes: " + err.message;
  }
}

["rangeSelect", "vehicleSelect", "outcomeSelect"].forEach((id) => byId(id).addEventListener("change", () => draw(true)));
loadMap(true);
window.onLiveUpdate = () => loadMap(false);
