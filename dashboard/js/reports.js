requireAuthOrRedirect();
renderSidebar("reports");

const STALE_MINUTES = 720; // matches heartbeatStaleMinutes in server/src/config.js
const OUTCOMES = [
  { key: "sent", label: "Alert sent", color: "#1fae63" },
  { key: "cancelled", label: "Cancelled", color: "#98a2b8" },
  { key: "failed", label: "Alert failed", color: "#e5484d" },
  { key: "open", label: "Open", color: "#f2a22c" }
];
const OUTCOME_OF = { alert_sent: "sent", cancelled: "cancelled", alert_failed: "failed", detected: "open", countdown: "open" };
const SIM_STATES = [
  { key: "ok", label: "Healthy", color: "#1fae63", badge: "ok" },
  { key: "low", label: "Low balance", color: "#e5484d", badge: "danger" },
  { key: "stale", label: "No recent check in", color: "#f2a22c", badge: "warn" },
  { key: "unknown", label: "Never checked in", color: "#98a2b8", badge: "neutral" }
];

const byId = (id) => document.getElementById(id);
let data = { events: [], vehicles: [], sims: [] };
let current = [];

function floorDate(date, unit) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (unit === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (unit === "month") d.setDate(1);
  return d;
}

function nextDate(date, unit) {
  const d = new Date(date);
  if (unit === "month") d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + (unit === "week" ? 7 : 1));
  return d;
}

function vehicleName(id) {
  const vehicle = data.vehicles.find((v) => v.id === id);
  return vehicle ? vehicle.name : "Unknown vehicle";
}

function simState(vehicleId) {
  const sim = data.sims.find((s) => s.vehicleId === vehicleId);
  if (!sim) return "unknown";
  if (sim.lowBalanceFlag) return "low";
  const minutes = sim.lastHeartbeatAt ? (Date.now() - new Date(sim.lastHeartbeatAt).getTime()) / 60000 : Infinity;
  return minutes > STALE_MINUTES ? "stale" : "ok";
}

function render() {
  const days = byId("rangeSelect").value;
  const vehicleId = byId("vehicleSelect").value;
  const now = new Date();
  const start = days === "all" ? null : floorDate(new Date(now.getTime() - (Number(days) - 1) * 864e5), "day");

  current = data.events.filter(
    (e) => (!start || new Date(e.detectedAt) >= start) && (!vehicleId || e.vehicleId === vehicleId)
  );
  const vehicles = vehicleId ? data.vehicles.filter((v) => v.id === vehicleId) : data.vehicles;

  const counts = { sent: 0, cancelled: 0, failed: 0, open: 0 };
  current.forEach((e) => { counts[OUTCOME_OF[e.status] || "open"]++; });
  const delivered = counts.sent + counts.failed;
  const rate = delivered ? Math.round((counts.sent / delivered) * 100) + "%" : "n/a";

  byId("statStrip").innerHTML =
    [
      [current.length, "Crashes detected", ""],
      [counts.sent, "Alerts sent", ""],
      [counts.cancelled, "Cancelled", ""],
      [counts.failed, "Alerts failed", counts.failed ? "danger" : ""],
      [rate, "Alert delivery rate", ""]
    ]
      .map((s) => '<div class="stat"><div class="value ' + s[2] + '">' + s[0] + '</div><div class="label">' + s[1] + "</div></div>")
      .join("");

  // Crashes over time, bucketed so the chart stays readable.
  let first = start;
  if (!first) {
    const times = current.map((e) => new Date(e.detectedAt).getTime());
    first = times.length ? new Date(Math.min.apply(null, times)) : now;
  }
  const span = Math.max(1, Math.ceil((now - first) / 864e5));
  const unit = span <= 31 ? "day" : span <= 210 ? "week" : "month";
  const buckets = new Map();
  for (let d = floorDate(first, unit); d <= now; d = nextDate(d, unit)) {
    buckets.set(d.getTime(), { label: d.toLocaleDateString(undefined, unit === "month" ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" }), counts: {} });
  }
  current.forEach((e) => {
    const bucket = buckets.get(floorDate(new Date(e.detectedAt), unit).getTime());
    if (bucket) {
      const key = OUTCOME_OF[e.status] || "open";
      bucket.counts[key] = (bucket.counts[key] || 0) + 1;
    }
  });
  const timeline = Array.from(buckets.values());
  byId("timelineTitle").textContent = "Crashes per " + unit;
  stackedBars(byId("timelineChart"), timeline, OUTCOMES, "Crashes per " + unit + ", split by outcome");

  donut(byId("outcomeChart"), OUTCOMES.map((o) => ({ label: o.label, color: o.color, value: counts[o.key] })), "Crash outcomes");

  const perVehicle = {};
  current.forEach((e) => { perVehicle[e.vehicleId] = (perVehicle[e.vehicleId] || 0) + 1; });
  const top = Object.keys(perVehicle)
    .map((id) => ({ label: vehicleName(id), value: perVehicle[id] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  if (top.length) hbars(byId("vehicleChart"), top, "#1c7ed6", "Crashes by vehicle");
  else byId("vehicleChart").innerHTML = '<div class="empty-state">No crashes in this range.</div>';

  const hours = Array.from({ length: 24 }, (_, h) => ({ label: String(h), counts: { all: 0 } }));
  current.forEach((e) => { hours[new Date(e.detectedAt).getHours()].counts.all++; });
  stackedBars(byId("hourChart"), hours, [{ key: "all", label: "Crashes", color: "#1c7ed6" }], "Crashes by hour of day");
  byId("hourChart").querySelector(".legend").remove();

  const simCounts = {};
  vehicles.forEach((v) => { const k = simState(v.id); simCounts[k] = (simCounts[k] || 0) + 1; });
  donut(byId("simChart"), SIM_STATES.map((s) => ({ label: s.label, color: s.color, value: simCounts[s.key] || 0 })), "SIM health");

  const rows = vehicles
    .map((v) => {
      const mine = current.filter((e) => e.vehicleId === v.id);
      const c = { sent: 0, cancelled: 0, failed: 0 };
      mine.forEach((e) => { if (c[OUTCOME_OF[e.status]] !== undefined) c[OUTCOME_OF[e.status]]++; });
      const last = mine.reduce((m, e) => (e.detectedAt > m ? e.detectedAt : m), "");
      return { v, total: mine.length, c, last, sim: SIM_STATES.find((s) => s.key === simState(v.id)) };
    })
    .sort((a, b) => b.total - a.total);

  byId("summaryBody").innerHTML = rows.length
    ? rows
        .map((r) =>
          "<tr><td>" + esc(r.v.name) + "</td><td>" + r.total + "</td><td>" + r.c.sent + "</td><td>" + r.c.cancelled + "</td><td>" + r.c.failed +
          '</td><td class="mono" data-v="' + (r.last || "") + '">' + (r.last ? new Date(r.last).toLocaleString() : "\u2014") + "</td>" +
          '<td><span class="badge ' + r.sim.badge + '">' + r.sim.label + "</span></td></tr>")
        .join("")
    : '<tr class="empty-row"><td colspan="7">No vehicles registered yet.</td></tr>';
}

byId("exportEvents").addEventListener("click", () => {
  downloadCsv("crash-events", [["Event ID", "Vehicle", "Detected at", "Status", "Latitude", "Longitude", "Notes"]].concat(
    current.map((e) => [e.id, vehicleName(e.vehicleId), e.detectedAt, e.status, e.latitude, e.longitude, e.notes])
  ));
});
byId("printReport").addEventListener("click", () => window.print());
byId("rangeSelect").addEventListener("change", render);
byId("vehicleSelect").addEventListener("change", render);

enhanceTable(byId("summaryBody").closest("table"), { name: "vehicle summary" });

async function loadReport() {
  try {
    const [events, vehicles, sims] = await Promise.all([api.getEvents(), api.getVehicles(), api.getSimStatuses()]);
    data = { events, vehicles, sims };
    const keepVehicle = byId("vehicleSelect").value;
    byId("vehicleSelect").innerHTML =
      '<option value="">All vehicles</option>' + vehicles.map((v) => '<option value="' + esc(v.id) + '">' + esc(v.name) + "</option>").join("");
    byId("vehicleSelect").value = keepVehicle;
    render();
  } catch (err) {
    byId("reportBody").innerHTML = '<div class="empty-state">Could not load reports: ' + esc(err.message) + "</div>";
  }
}
loadReport();
window.onLiveUpdate = loadReport;
