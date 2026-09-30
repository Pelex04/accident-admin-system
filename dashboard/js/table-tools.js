// Shared helpers: search, filters, date range, sorting, paging and CSV export for any data table.

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

// Header flags: data-filter adds a dropdown, data-noexport leaves the column out of the CSV,
// data-nosort disables sorting. Cells may carry data-v with a sortable value (for example an ISO date).
// Options: name, dates (From/To filter, rows need data-ts), pageSize (default 25).
function enhanceTable(table, options) {
  const opts = options || {};
  const name = opts.name || "rows";
  const size = opts.pageSize || 25;
  const tbody = table.tBodies[0];
  const heads = Array.from(table.tHead.rows[0].cells);
  const filterCols = heads.map((h, i) => (h.hasAttribute("data-filter") ? i : -1)).filter((i) => i >= 0);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  let sortCol = -1, sortDir = 1, page = 1;

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

  const pager = document.createElement("div");
  pager.className = "pager";
  pager.hidden = true;
  pager.innerHTML =
    '<button type="button" class="btn secondary pg-prev">Previous</button><span class="pg-info muted"></span>' +
    '<button type="button" class="btn secondary pg-next">Next</button>';
  table.parentNode.insertBefore(pager, none.nextSibling);

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
    select.addEventListener("change", () => refresh(true));
  });

  const dataRows = () => Array.from(tbody.rows).filter((r) => !r.classList.contains("empty-row"));

  function cellText(cell) {
    const select = cell.querySelector("select");
    const text = select ? select.options[select.selectedIndex].text : cell.textContent;
    return text.trim().replace(/\s+/g, " ");
  }

  const sortKey = (row, i) => (row.cells[i].dataset.v !== undefined ? row.cells[i].dataset.v : cellText(row.cells[i]));

  heads.forEach((h, i) => {
    if (!h.textContent.trim() || h.hasAttribute("data-noexport") || h.hasAttribute("data-nosort")) return;
    h.classList.add("sortable");
    h.tabIndex = 0;
    const toggle = () => {
      if (sortCol !== i) { sortCol = i; sortDir = 1; }
      else if (sortDir === 1) sortDir = -1;
      else { sortCol = -1; sortDir = 1; }
      heads.forEach((x, j) => x.setAttribute("aria-sort", j === sortCol ? (sortDir === 1 ? "ascending" : "descending") : "none"));
      refresh(true);
    };
    h.addEventListener("click", toggle);
    h.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  });

  // Pages redraw the table body after every load or edit, so re-apply everything each time.
  const observer = new MutationObserver(() => refresh());

  function refresh(resetPage) {
    let rows = dataRows();
    rows.forEach((r, i) => { if (r._o === undefined) r._o = i; });
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

    rows.forEach((row) => {
      const texts = Array.from(row.cells).map(cellText);
      const ts = row.dataset.ts ? new Date(row.dataset.ts) : null;
      row._m =
        (!q || texts.join(" ").toLowerCase().indexOf(q) >= 0) &&
        filterCols.every((i) => !selects[i].value || texts[i] === selects[i].value) &&
        (!from || (ts && ts >= from)) &&
        (!to || (ts && ts <= to));
    });

    const sorted = rows.slice().sort(
      sortCol < 0
        ? (a, b) => a._o - b._o
        : (a, b) => {
            const ka = sortKey(a, sortCol), kb = sortKey(b, sortCol);
            if (!ka && kb) return 1;
            if (ka && !kb) return -1;
            return collator.compare(ka, kb) * sortDir;
          }
    );
    if (sorted.some((r, i) => r !== rows[i])) {
      sorted.forEach((r) => tbody.appendChild(r));
      observer.takeRecords();
    }
    rows = sorted;

    const matched = rows.filter((r) => r._m);
    const pages = Math.max(1, Math.ceil(matched.length / size));
    page = resetPage === true ? 1 : Math.min(page, pages);
    rows.forEach((r) => { r.hidden = true; });
    matched.slice((page - 1) * size, page * size).forEach((r) => { r.hidden = false; });

    const label = (n) => n + (n === 1 ? " row" : " rows");
    count.textContent = matched.length === rows.length ? label(rows.length) : matched.length + " of " + label(rows.length);
    none.hidden = !(rows.length > 0 && matched.length === 0);
    pager.hidden = pages <= 1;
    pager.querySelector(".pg-info").textContent = "Page " + page + " of " + pages;
    pager.querySelector(".pg-prev").disabled = page <= 1;
    pager.querySelector(".pg-next").disabled = page >= pages;
  }

  pager.querySelector(".pg-prev").addEventListener("click", () => { page--; refresh(); });
  pager.querySelector(".pg-next").addEventListener("click", () => { page++; refresh(); });

  bar.querySelector(".tt-export").addEventListener("click", () => {
    const cols = heads
      .map((h, i) => ({ text: h.textContent.trim(), i, skip: h.hasAttribute("data-noexport") }))
      .filter((c) => c.text && !c.skip);
    const rows = dataRows().filter((r) => r._m);
    downloadCsv(name, [cols.map((c) => c.text)].concat(rows.map((r) => cols.map((c) => cellText(r.cells[c.i])))));
  });

  search.addEventListener("input", () => refresh(true));
  [fromInput, toInput].forEach((input) => input && input.addEventListener("change", () => refresh(true)));

  if (!tbody.rows.length) {
    let skeleton = "";
    for (let n = 0; n < 4; n++) skeleton += '<tr class="empty-row skeleton-row"><td colspan="' + heads.length + '"><span class="sk"></span></td></tr>';
    tbody.innerHTML = skeleton;
  }
  observer.observe(tbody, { childList: true });
  refresh();
}
