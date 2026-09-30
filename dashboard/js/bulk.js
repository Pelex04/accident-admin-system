// Bulk tools: CSV import dialog (openImport) and row selection with bulk actions (enableBulk).
// Needs nav.js (toast, confirmDialog) and table-tools.js (esc, downloadCsv).

function parseCsv(text) {
  text = text.replace(/^\ufeff/, "");
  const first = text.split(/\r?\n/)[0];
  const delim = first.split(";").length > first.split(",").length ? ";" : ",";
  const rows = [];
  let row = [], field = "", quoted = false;
  const endRow = () => { row.push(field); field = ""; if (row.some((c) => c.trim() !== "")) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; endRow(); }
    else field += ch;
  }
  endRow();
  return rows;
}

// cfg: title, columns [{ key, label, required, aliases }], template (rows), check(record, seen) -> error or null,
// run(record) -> Promise, done() -> called after importing.
function openImport(cfg) {
  const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, "");
  const scrim = document.createElement("div");
  scrim.className = "modal-scrim";
  scrim.innerHTML =
    '<div class="modal wide" role="dialog" aria-modal="true"><h2></h2>' +
    '<p class="muted">Upload a CSV file or paste it below. Columns: <b class="cols"></b>. <a href="#" class="tpl">Download a template</a></p>' +
    '<input type="file" class="imp-file" accept=".csv,text/csv" aria-label="CSV file">' +
    '<textarea class="imp-text" placeholder="Or paste CSV here" aria-label="Pasted CSV"></textarea>' +
    '<div class="import-summary muted"></div><ul class="import-problems"></ul><div class="import-preview"></div>' +
    '<div class="modal-actions"><button type="button" class="btn secondary imp-cancel">Cancel</button>' +
    '<button type="button" class="btn imp-go" disabled>Import</button></div></div>';
  scrim.querySelector("h2").textContent = cfg.title;
  scrim.querySelector(".cols").textContent = cfg.columns.map((c) => c.label + (c.required ? "" : " (optional)")).join(", ");

  const text = scrim.querySelector(".imp-text"), go = scrim.querySelector(".imp-go");
  const summary = scrim.querySelector(".import-summary"), problems = scrim.querySelector(".import-problems"), preview = scrim.querySelector(".import-preview");
  let good = [], importing = false;

  const close = () => { document.removeEventListener("keydown", onKey); scrim.remove(); };
  const onKey = (e) => { if (e.key === "Escape" && !importing) close(); };

  function analyze() {
    good = [];
    problems.innerHTML = "";
    preview.innerHTML = "";
    const rows = parseCsv(text.value);
    if (rows.length < 2) { summary.textContent = rows.length ? "Add at least one data row under the header." : ""; go.disabled = true; go.textContent = "Import"; return; }
    const heads = rows[0].map(norm);
    const idx = {};
    cfg.columns.forEach((c) => { idx[c.key] = heads.findIndex((h) => [c.key, c.label].concat(c.aliases || []).map(norm).indexOf(h) >= 0); });
    const missing = cfg.columns.filter((c) => c.required && idx[c.key] < 0);
    if (missing.length) {
      summary.textContent = "Missing column: " + missing.map((c) => c.label).join(", ");
      go.disabled = true; go.textContent = "Import";
      return;
    }
    const seen = new Set(), bad = [];
    rows.slice(1).forEach((cells, n) => {
      const rec = {};
      cfg.columns.forEach((c) => { rec[c.key] = idx[c.key] >= 0 ? String(cells[idx[c.key]] || "").trim() : ""; });
      const missingField = cfg.columns.find((c) => c.required && !rec[c.key]);
      const angle = cfg.columns.some((c) => /[<>]/.test(rec[c.key]));
      const error = missingField ? missingField.label + " is empty" : angle ? "Contains < or >, which is not allowed" : cfg.check(rec, seen);
      if (error) bad.push("Row " + (n + 2) + ": " + error); else good.push(rec);
    });
    summary.textContent = good.length + " ready to import" + (bad.length ? ", " + bad.length + " skipped" : "") + ".";
    problems.innerHTML = bad.slice(0, 5).map((b) => "<li>" + esc(b) + "</li>").join("") + (bad.length > 5 ? "<li>" + (bad.length - 5) + " more skipped</li>" : "");
    if (good.length) {
      preview.innerHTML = '<table class="data-table"><thead><tr>' + cfg.columns.map((c) => "<th>" + esc(c.label) + "</th>").join("") + "</tr></thead><tbody>" +
        good.slice(0, 5).map((r) => "<tr>" + cfg.columns.map((c) => "<td>" + esc(r[c.key]) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
    }
    go.disabled = !good.length;
    go.textContent = "Import " + good.length;
  }

  scrim.querySelector(".imp-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { text.value = String(reader.result); analyze(); };
    reader.readAsText(file);
  });
  text.addEventListener("input", analyze);
  scrim.querySelector(".tpl").addEventListener("click", (e) => { e.preventDefault(); downloadCsv(cfg.title + " template", cfg.template); });
  scrim.querySelector(".imp-cancel").addEventListener("click", () => { if (!importing) close(); });

  go.addEventListener("click", async () => {
    importing = true;
    go.disabled = true;
    let ok = 0;
    for (let i = 0; i < good.length; i++) {
      go.textContent = "Importing " + (i + 1) + " of " + good.length + "...";
      try { await cfg.run(good[i]); ok++; } catch (err) { /* counted below */ }
    }
    close();
    toast("Imported " + ok + " of " + good.length, ok === good.length ? "ok" : "danger");
    if (cfg.done) await cfg.done();
  });

  document.addEventListener("keydown", onKey);
  document.body.appendChild(scrim);
}

// Adds a checkbox to the first cell of every row that has data-id, plus a bulk action bar.
// cfg: actions [{ value, label, danger }], apply(id, value) -> Promise, reload(), noun.
function enableBulk(table, cfg) {
  const tbody = table.tBodies[0];
  const headCell = table.tHead.rows[0].cells[0];
  const all = document.createElement("input");
  all.type = "checkbox";
  all.className = "bulk-all";
  all.setAttribute("aria-label", "Select all visible rows");
  all.addEventListener("click", (e) => e.stopPropagation());
  headCell.insertBefore(all, headCell.firstChild);

  const bar = document.createElement("div");
  bar.className = "bulkbar";
  bar.hidden = true;
  bar.innerHTML =
    '<span class="bulk-count"></span><select class="bulk-action" aria-label="Bulk action">' +
    cfg.actions.map((a) => '<option value="' + esc(a.value) + '">' + esc(a.label) + "</option>").join("") +
    '</select><button type="button" class="btn bulk-apply">Apply</button><button type="button" class="btn secondary bulk-clear">Clear</button>';
  table.parentNode.insertBefore(bar, table);

  const rows = () => Array.from(tbody.rows).filter((r) => r.dataset.id);
  const selected = () => rows().filter((r) => { const c = r.querySelector(".bulk-check"); return c && c.checked; });

  function update() {
    const n = selected().length;
    bar.hidden = n === 0;
    bar.querySelector(".bulk-count").textContent = n + " selected";
    const visible = rows().filter((r) => !r.hidden);
    all.checked = n > 0 && visible.length > 0 && visible.every((r) => r.querySelector(".bulk-check").checked);
  }

  function decorate() {
    rows().forEach((r) => {
      if (r.querySelector(".bulk-check")) return;
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "bulk-check";
      box.setAttribute("aria-label", "Select row");
      r.cells[0].insertBefore(box, r.cells[0].firstChild);
    });
    update();
  }

  tbody.addEventListener("change", (e) => { if (e.target.classList.contains("bulk-check")) update(); });
  all.addEventListener("change", () => {
    rows().filter((r) => !r.hidden).forEach((r) => { r.querySelector(".bulk-check").checked = all.checked; });
    update();
  });
  bar.querySelector(".bulk-clear").addEventListener("click", () => {
    rows().forEach((r) => { r.querySelector(".bulk-check").checked = false; });
    update();
  });
  bar.querySelector(".bulk-apply").addEventListener("click", async () => {
    const ids = selected().map((r) => r.dataset.id);
    const action = cfg.actions.find((a) => a.value === bar.querySelector(".bulk-action").value);
    if (!ids.length || !action) return;
    if (action.danger && !(await confirmDialog(action.label + " " + ids.length + " " + cfg.noun + "? This cannot be undone.", action.label))) return;
    let ok = 0;
    for (const id of ids) {
      try { await cfg.apply(id, action.value); ok++; } catch (err) { /* counted below */ }
    }
    toast(action.label + ": " + ok + " of " + ids.length + " " + cfg.noun, ok === ids.length ? "ok" : "danger");
    await cfg.reload();
  });

  new MutationObserver(decorate).observe(tbody, { childList: true });
  decorate();
}
