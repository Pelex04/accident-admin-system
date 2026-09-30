requireAuthOrRedirect();
renderSidebar("vehicles");

const byId = (id) => document.getElementById(id);
const vehicleId = new URLSearchParams(window.location.search).get("id");
const STALE_MINUTES = 720; // matches heartbeatStaleMinutes in server/src/config.js

enhanceTable(byId("historyBody").closest("table"), { name: "vehicle crashes", dates: true });

function simBadge(sim) {
  if (!sim) return '<span class="badge neutral">never checked in</span>';
  if (sim.lowBalanceFlag) return '<span class="badge danger">low balance</span>';
  const minutes = sim.lastHeartbeatAt ? (Date.now() - new Date(sim.lastHeartbeatAt).getTime()) / 60000 : Infinity;
  return minutes > STALE_MINUTES ? '<span class="badge warn">no recent check in</span>' : '<span class="badge ok">healthy</span>';
}

async function loadVehicle() {
  if (!vehicleId) { byId("vTitle").textContent = "No vehicle selected"; return; }
  try {
    const [vehicle, contacts, events, sim] = await Promise.all([
      api.getVehicle(vehicleId),
      api.getVehicleContacts(vehicleId).catch(() => []),
      api.getEvents({ vehicleId }).catch(() => []),
      api.getSimStatus(vehicleId).catch(() => null)
    ]);
    const active = vehicle.status === "active";
    const count = (s) => events.filter((e) => e.status === s).length;

    byId("vTitle").textContent = vehicle.name;
    byId("vSub").textContent = "Registered " + new Date(vehicle.registeredAt).toLocaleDateString();
    byId("kpis").innerHTML =
      [["Crashes", events.length, ""], ["Alerts sent", count("alert_sent"), "ok"], ["Cancelled", count("cancelled"), ""], ["Alerts failed", count("alert_failed"), count("alert_failed") ? "danger" : "ok"]]
        .map((k) => '<div class="kpi ' + k[2] + '"><div class="label">' + k[0] + '</div><div class="value">' + k[1] + "</div></div>").join("");

    byId("facts").innerHTML =
      "<dt>Status</dt><dd><span class=\"badge " + (active ? "ok" : "neutral") + '">' + esc(vehicle.status) + "</span></dd>" +
      '<dt>SIM number</dt><dd class="mono">' + esc(vehicle.arduinoSimNumber) + "</dd>" +
      "<dt>Contacts</dt><dd>" + contacts.length + "</dd>";
    byId("factActions").innerHTML = '<button type="button" class="btn secondary" id="toggleStatus">' + (active ? "Deactivate" : "Activate") + "</button>";

    byId("simFacts").innerHTML =
      "<dt>State</dt><dd>" + simBadge(sim) + "</dd>" +
      '<dt>Last check in</dt><dd class="mono">' + (sim && sim.lastHeartbeatAt ? new Date(sim.lastHeartbeatAt).toLocaleString() : "\u2014") + "</dd>" +
      '<dt>Balance text</dt><dd class="mono">' + esc((sim && sim.lastKnownBalanceText) || "\u2014") + "</dd>";
    byId("simActions").innerHTML = sim && sim.lowBalanceFlag ? '<button type="button" class="btn secondary" id="toppedUp">Mark topped up</button>' : "";

    byId("contactsBody").innerHTML = contacts.length
      ? contacts.map((c) => "<tr><td>" + esc(c.name) + '</td><td class="mono">' + esc(c.phoneNumber) + "</td><td>" + esc(c.priority) + "</td></tr>").join("")
      : '<tr class="empty-row"><td colspan="3">No emergency contacts yet.</td></tr>';

    byId("historyBody").innerHTML = events.length
      ? events.map((e) =>
          '<tr data-ts="' + esc(e.detectedAt) + '"><td class="mono" data-v="' + esc(e.detectedAt) + '"><a href="event.html?id=' + esc(e.id) + '">' +
          new Date(e.detectedAt).toLocaleString() + "</a></td><td>" + statusBadge(e.status) + '</td><td class="mono">' +
          (e.latitude !== null && e.longitude !== null ? esc(e.latitude + ", " + e.longitude) : "\u2014") + '</td><td class="muted">' + esc(e.notes || "\u2014") + "</td></tr>").join("")
      : '<tr class="empty-row"><td colspan="4">No crashes recorded for this vehicle.</td></tr>';

    byId("toggleStatus").addEventListener("click", async () => {
      try { await api.updateVehicle(vehicleId, { status: active ? "inactive" : "active" }); toast(active ? "Vehicle deactivated" : "Vehicle activated", "ok"); loadVehicle(); }
      catch (err) { toast(err.message, "danger"); }
    });
    const topped = byId("toppedUp");
    if (topped) topped.addEventListener("click", async () => {
      try { await api.markToppedUp(vehicleId); toast("Marked as topped up", "ok"); loadVehicle(); }
      catch (err) { toast(err.message, "danger"); }
    });
  } catch (err) {
    byId("vTitle").textContent = "Vehicle not found";
    byId("vSub").textContent = err.message;
  }
}

loadVehicle();
window.onLiveUpdate = loadVehicle;
