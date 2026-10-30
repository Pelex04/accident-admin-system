// Distance and drive time from a starting point to a crash.
//
// Uses an OSRM compatible routing service. The default is the public demo server, which is free but has no
// guarantee and asks for light use. Set ROUTING_URL to your own OSRM server or a paid service when you want
// something you can rely on, or set it to "off" to skip routing and always give the straight line estimate.
// If the service is slow, down or answers with something odd, the caller still gets a clearly labelled estimate
// instead of an error, so the board never shows an empty gap where the figure should be.

const DEFAULT_URL = 'https://router.project-osrm.org';
const TIMEOUT_MS = 4000;
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const ROAD_FACTOR = 1.4;      // roads are longer than the straight line between two points
// Routing engines time a trip as if the roads were empty and every junction clear. In a busy city a real drive takes
// noticeably longer. This multiplier corrects for that. 1.7 comes from one real trip (a 4 km city drive the engine
// called 6 minutes took 10 to 12), so treat it as a starting point and set ROUTE_TIME_FACTOR once you have compared a few.
const DEFAULT_TIME_FACTOR = 1.7;
const ESTIMATE_KMH = 40;      // a cautious average for mixed roads

const cache = new Map();

function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const round1 = (n) => Math.round(n * 10) / 10;

function estimate(from, to) {
  const km = haversineKm(from, to) * ROAD_FACTOR;
  return { distanceKm: round1(km), minutes: Math.max(1, Math.round((km / ESTIMATE_KMH) * 60)), source: 'estimate' };
}

function timeFactor() {
  const f = Number(process.env.ROUTE_TIME_FACTOR);
  return Number.isFinite(f) && f >= 1 && f <= 5 ? f : DEFAULT_TIME_FACTOR;
}

const key = (from, to) => [from.lat, from.lng, to.lat, to.lng].map((n) => n.toFixed(4)).join(',');

async function roadRoute(from, to, baseUrl) {
  const url = `${baseUrl.replace(/\/+$/, '')}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('routing service answered ' + res.status);
  const body = await res.json();
  const r = body && body.code === 'Ok' && Array.isArray(body.routes) ? body.routes[0] : null;
  if (!r || !Number.isFinite(r.distance) || !Number.isFinite(r.duration) || r.distance < 0 || r.duration < 0) {
    throw new Error('routing service gave no usable route');
  }
  return { distanceKm: round1(r.distance / 1000), seconds: r.duration };
}

const withTime = (raw) => ({ distanceKm: raw.distanceKm, minutes: Math.max(1, Math.round((raw.seconds / 60) * timeFactor())), source: 'road' });

// Read at call time, not at load, so tests and deployments can change it without a restart of the module.
async function route(from, to) {
  const k = key(from, to);
  const hit = cache.get(k);
  if (hit && hit.until > Date.now()) return withTime(hit.value);

  const configured = (process.env.ROUTING_URL === undefined ? DEFAULT_URL : process.env.ROUTING_URL).trim();
  if (!configured || configured.toLowerCase() === 'off') return estimate(from, to);

  try {
    const raw = await roadRoute(from, to, configured);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(k, { value: raw, until: Date.now() + CACHE_MS });   // the raw answer is kept, so changing the factor applies at once
    return withTime(raw);
  } catch (err) {
    // Not cached: the next request tries the service again.
    return estimate(from, to);
  }
}

module.exports = { route, estimate, haversineKm, timeFactor, _cache: cache };
