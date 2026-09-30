// Small SVG charts with no dependencies. Needs esc() from table-tools.js.

const CHART_TICKS = [4, 8, 12, 20, 40, 80, 120, 200, 400, 800, 1200, 2000, 4000];

function niceMax(value) {
  return CHART_TICKS.find((t) => t >= value) || Math.ceil(value / 1000) * 1000;
}

function legendHtml(items) {
  return (
    '<ul class="legend">' +
    items
      .map((i) =>
        '<li><span class="swatch" style="background:' + i.color + '"></span>' + esc(i.label) +
        (i.value !== undefined ? " <b>" + i.value + "</b>" : "") + "</li>")
      .join("") +
    "</ul>"
  );
}

// buckets: [{ label, counts: { key: n } }], series: [{ key, label, color }]
function stackedBars(el, buckets, series, label) {
  const W = 640, H = 230, L = 34, R = 6, T = 10, B = 30;
  const iw = W - L - R, ih = H - T - B;
  const totals = buckets.map((b) => series.reduce((sum, s) => sum + (b.counts[s.key] || 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const step = iw / buckets.length;
  const bw = Math.max(2, Math.min(28, step * 0.68));
  const every = Math.ceil(buckets.length / 8);
  let out = "";

  for (let i = 0; i <= 4; i++) {
    const y = T + ih - (ih * i) / 4;
    out += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/>' +
      '<text class="axis" x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + (max * i) / 4 + "</text>";
  }

  buckets.forEach((b, i) => {
    const x = L + step * i + (step - bw) / 2;
    let y = T + ih;
    series.forEach((s) => {
      const n = b.counts[s.key] || 0;
      if (!n) return;
      const h = (ih * n) / max;
      y -= h;
      out += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + h + '" fill="' + s.color + '"><title>' +
        esc(b.label) + ": " + n + " " + esc(s.label.toLowerCase()) + "</title></rect>";
    });
    if (i % every === 0) {
      out += '<text class="axis" x="' + (x + bw / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(b.label) + "</text>";
    }
  });

  el.innerHTML =
    '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(label) + '">' + out + "</svg>" +
    legendHtml(series);
}

// items: [{ label, value }]
function hbars(el, items, color, label) {
  const W = 640, row = 30, L = 150, R = 44;
  const H = items.length * row + 6;
  const max = Math.max(1, ...items.map((i) => i.value));
  let out = "";

  items.forEach((item, i) => {
    const y = i * row + 4;
    const w = Math.max(2, ((W - L - R) * item.value) / max);
    const text = item.label.length > 22 ? item.label.slice(0, 21) + "\u2026" : item.label;
    out += '<text class="axis" x="' + (L - 10) + '" y="' + (y + 15) + '" text-anchor="end">' + esc(text) + "</text>" +
      '<rect x="' + L + '" y="' + y + '" width="' + w + '" height="20" rx="3" fill="' + color + '"><title>' +
      esc(item.label) + ": " + item.value + "</title></rect>" +
      '<text class="axis strong" x="' + (L + w + 6) + '" y="' + (y + 15) + '">' + item.value + "</text>";
  });

  el.innerHTML = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(label) + '">' + out + "</svg>";
}

// items: [{ label, value, color }]
function donut(el, items, label) {
  const total = items.reduce((sum, i) => sum + i.value, 0);
  const r = 62, c = 2 * Math.PI * r;
  let offset = 0, arcs = "";

  items.forEach((i) => {
    if (!i.value) return;
    const len = (c * i.value) / total;
    arcs += '<circle cx="80" cy="80" r="' + r + '" fill="none" stroke="' + i.color + '" stroke-width="24" stroke-dasharray="' +
      len + " " + (c - len) + '" stroke-dashoffset="' + -offset + '" transform="rotate(-90 80 80)"><title>' +
      esc(i.label) + ": " + i.value + "</title></circle>";
    offset += len;
  });

  el.innerHTML =
    '<div class="donut"><svg viewBox="0 0 160 160" role="img" aria-label="' + esc(label) + '">' +
    (total ? arcs : '<circle cx="80" cy="80" r="62" fill="none" stroke="#e3e8f0" stroke-width="24"/>') +
    '<text class="donut-total" x="80" y="82" text-anchor="middle">' + total + "</text>" +
    '<text class="axis" x="80" y="100" text-anchor="middle">total</text></svg>' +
    legendHtml(items) + "</div>";
}
