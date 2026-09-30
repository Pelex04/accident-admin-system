// Shared helpers: search, filters, date range and CSV export for any data table.

function esc(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function csvCell(value) {
  let text = String(value === null || value === undefined ? "" : value);
  // Stop spreadsheets from running text as a formula.
  if (/^([=@\t\r]|[+-](?![\d\s().-]+$))/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function downloadCsv(name, rows) {
  const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + body], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name.replace(/\s+/g, "-").toLowerCase() + "-" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Header flags: data-filter adds a dropdown for that column, data-noexport leaves it out of the CSV.
// Options: name (for labels and file name), dates (true adds a From/To filter, rows need data-ts).
function enhanceTable(table, options) {
  const opts = options || {};
  const name = opts.name || "rows";
  const tbody = table.tBodies[0];
  const heads = Array.from(table.tHead.rows[0].cells);
  const filterCols = heads.map((h, i) => (h.hasAttribute("data-filter") ? i : -1)).filter((i) => i >= 0);

  const bar = document.createElement("div");
  bar.className = "toolbar";
  bar.innerHTML =
    '<input type="search" class="tt-search" aria-label="Search ' + esc(name) + '" placeholder="Search ' + esc(name) + '...">' +
    '<span class="tt-filters"></span>' +
    (opts.dates
      ? '<label class="tt-date">From <input type="date" class="tt-from"></label><label class="tt-date">To <input type="date" class="tt-to"></label>'
      : "") +
    '<span class="tt-count muted"></span>' +
    '<button type="button" class="btn secondary tt-export">Export CSV</button>';
  table.parentNode.insertBefore(bar, table);

  const none = document.createElement("div");
  none.className = "tt-none";
  none.hidden = true;
  none.textContent = "Nothing matches these filters.";
  table.parentNode.insertBefore(none, table.nextSibling);

  const search = bar.querySelector(".tt-search");
  const count = bar.querySelector(".tt-count");
  const fromInput = bar.querySelector(".tt-from");
  const toInput = bar.querySelector(".tt-to");
  const selects = {};

  filterCols.forEach((i) => {
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Filter by " + heads[i].textContent.trim().toLowerCase());
    selects[i] = select;
    bar.querySelector(".tt-filters").appendChild(select);
    select.addEventListener("change", refresh);
  });

  const dataRows = () => Array.from(tbody.rows).filter((r) => !r.classList.contains("empty-row"));

  function cellText(cell) {
    const select = cell.querySelector("select");
    const text = select ? select.options[select.selectedIndex].text : cell.textContent;
    return text.trim().replace(/\s+/g, " ");
  }

  function refresh() {
    const rows = dataRows();
    const q = search.value.trim().toLowerCase();
    const from = fromInput && fromInput.value ? new Date(fromInput.value + "T00:00:00") : null;
    const to = toInput && toInput.value ? new Date(toInput.value + "T23:59:59.999") : null;

    filterCols.forEach((i) => {
      const select = selects[i];
      const previous = select.value;
      const values = Array.from(new Set(rows.map((r) => cellText(r.cells[i])))).filter(Boolean).sort();
      select.innerHTML =
        '<option value="">' + esc(heads[i].textContent.trim()) + ": all</option>" +
        values.map((v) => '<option value="' + esc(v) + '">' + esc(v) + "</option>").join("");
      select.value = values.indexOf(previous) >= 0 ? previous : "";
    });

    let shown = 0;
    rows.forEach((row) => {
      const texts = Array.from(row.cells).map(cellText);
      const ts = row.dataset.ts ? new Date(row.dataset.ts) : null;
      const ok =
        (!q || texts.join(" ").toLowerCase().indexOf(q) >= 0) &&
        filterCols.every((i) => !selects[i].value || texts[i] === selects[i].value) &&
        (!from || (ts && ts >= from)) &&
        (!to || (ts && ts <= to));
      row.hidden = !ok;
      if (ok) shown++;
    });

    const label = (n) => n + (n === 1 ? " row" : " rows");
    count.textContent = shown === rows.length ? label(rows.length) : shown + " of " + label(rows.length);
    none.hidden = !(rows.length > 0 && shown === 0);
  }

  bar.querySelector(".tt-export").addEventListener("click", () => {
    const cols = heads
      .map((h, i) => ({ text: h.textContent.trim(), i, skip: h.hasAttribute("data-noexport") }))
      .filter((c) => c.text && !c.skip);
    const rows = dataRows().filter((r) => !r.hidden);
    downloadCsv(name, [cols.map((c) => c.text)].concat(rows.map((r) => cols.map((c) => cellText(r.cells[c.i])))));
  });

  search.addEventListener("input", refresh);
  [fromInput, toInput].forEach((input) => input && input.addEventListener("change", refresh));
  // Pages redraw the table body after every load or edit, so re-apply filters each time.
  new MutationObserver(refresh).observe(tbody, { childList: true });
  refresh();
}
