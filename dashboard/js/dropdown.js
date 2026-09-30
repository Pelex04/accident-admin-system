// Custom dropdowns. Upgrades every <select> in place and keeps the native select in the DOM as the
// source of truth, so code that reads .value or listens for "change" keeps working. Selects added
// later (table rows, toolbars, dialogs) are picked up automatically. Add data-native to skip one.
(function () {
  const SEARCH_MIN = 8;
  const CHEVRON =
    '<svg class="dd-chev" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg>';
  let openDd = null;
  let seq = 0;

  function enhance(select) {
    if (select._dd || select.multiple || select.size > 1 || select.hasAttribute("data-native")) return;
    select._dd = true;

    const id = "dd" + ++seq;
    const labelEl = select.id ? document.querySelector('label[for="' + select.id + '"]') : null;
    const baseName = select.getAttribute("aria-label") || (labelEl ? labelEl.textContent.trim() : "");

    const wrap = document.createElement("div");
    wrap.className = "dd";
    if (select.style.width) wrap.style.width = select.style.width;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dd-btn";
    btn.setAttribute("role", "combobox");
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", id + "-menu");
    btn.innerHTML = '<span class="dd-label"></span>' + CHEVRON;
    const label = btn.firstChild;

    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(btn);
    wrap.appendChild(select);
    select.classList.add("dd-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    if (labelEl) labelEl.addEventListener("click", (e) => { e.preventDefault(); btn.focus(); });

    let menu = null, list = null, search = null, empty = null, buffer = "", bufferAt = 0;
    const inst = { wrap, menu: () => menu, close };

    function sync() {
      const o = select.options[select.selectedIndex];
      label.textContent = o ? o.text : "";
      btn.disabled = select.disabled;
      btn.setAttribute("aria-label", (baseName ? baseName + ": " : "") + label.textContent);
    }

    const optionEls = () => Array.from(list.querySelectorAll('li[role="option"]'));
    const visible = () => optionEls().filter((li) => !li.hidden && li.getAttribute("aria-disabled") !== "true");

    function setActive(li) {
      const prev = list.querySelector(".dd-active");
      if (prev) prev.classList.remove("dd-active");
      const target = search || btn;
      if (!li) { target.removeAttribute("aria-activedescendant"); return; }
      li.classList.add("dd-active");
      const top = li.offsetTop, bottom = top + li.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
      target.setAttribute("aria-activedescendant", li.id);
    }

    function move(step) {
      const v = visible();
      if (!v.length) return;
      const cur = v.indexOf(list.querySelector(".dd-active"));
      setActive(v[Math.max(0, Math.min(v.length - 1, cur + step))]);
    }

    function choose(i) {
      if (i !== select.selectedIndex) {
        select.selectedIndex = i;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      close(true);
    }

    function position() {
      const r = btn.getBoundingClientRect();
      menu.style.minWidth = r.width + "px";
      menu.style.maxHeight = "300px";
      const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
      const up = menu.offsetHeight > below && above > below;
      const room = up ? above : below;
      if (menu.offsetHeight > room) menu.style.maxHeight = Math.max(140, room) + "px";
      menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + "px";
      menu.style.top = (up ? r.top - menu.offsetHeight - 6 : r.bottom + 6) + "px";
    }

    function filter() {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      optionEls().forEach((li) => {
        li.hidden = !!q && li.textContent.toLowerCase().indexOf(q) < 0;
        if (!li.hidden) shown++;
      });
      empty.hidden = shown > 0;
      setActive(visible()[0]);
    }

    function open() {
      if (menu || btn.disabled) return;
      if (openDd) openDd.close(false);
      const many = select.options.length > SEARCH_MIN;
      menu = document.createElement("div");
      menu.className = "dd-menu";
      menu.innerHTML =
        (many ? '<input class="dd-search" type="text" placeholder="Search..." aria-label="Search options" autocomplete="off" spellcheck="false">' : "") +
        '<ul role="listbox" id="' + id + '-menu"></ul>';
      list = menu.querySelector("ul");
      search = menu.querySelector(".dd-search");
      if (baseName) list.setAttribute("aria-label", baseName);

      Array.from(select.options).forEach((o, i) => {
        const li = document.createElement("li");
        li.id = id + "-o" + i;
        li.dataset.i = i;
        li.setAttribute("role", "option");
        li.textContent = o.text;
        if (o.disabled) li.setAttribute("aria-disabled", "true");
        if (i === select.selectedIndex) li.setAttribute("aria-selected", "true");
        list.appendChild(li);
      });
      empty = document.createElement("li");
      empty.className = "dd-empty";
      empty.setAttribute("role", "presentation");
      empty.textContent = "No matches";
      empty.hidden = true;
      list.appendChild(empty);

      document.body.appendChild(menu);
      position();
      btn.setAttribute("aria-expanded", "true");
      wrap.classList.add("open");
      openDd = inst;
      setActive(list.querySelector('[aria-selected="true"]') || visible()[0]);

      menu.addEventListener("mousedown", (e) => { if (e.target !== search) e.preventDefault(); });
      list.addEventListener("click", (e) => {
        const li = e.target.closest('li[role="option"]');
        if (li && li.getAttribute("aria-disabled") !== "true") choose(Number(li.dataset.i));
      });
      list.addEventListener("mousemove", (e) => {
        const li = e.target.closest('li[role="option"]');
        if (li && !li.classList.contains("dd-active") && li.getAttribute("aria-disabled") !== "true") setActive(li);
      });
      if (search) {
        search.addEventListener("keydown", onKey);
        search.addEventListener("input", filter);
        search.focus();
      }
    }

    function close(refocus) {
      if (!menu) return;
      menu.remove();
      menu = list = search = empty = null;
      btn.setAttribute("aria-expanded", "false");
      btn.removeAttribute("aria-activedescendant");
      wrap.classList.remove("open");
      if (openDd === inst) openDd = null;
      if (refocus) btn.focus();
    }

    function typeahead(ch, closed) {
      const now = Date.now();
      buffer = now - bufferAt > 700 ? ch.toLowerCase() : buffer + ch.toLowerCase();
      bufferAt = now;
      if (closed) {
        const opts = Array.from(select.options), n = opts.length;
        const from = Math.max(0, select.selectedIndex + (buffer.length === 1 ? 1 : 0));
        for (let j = 0; j < n; j++) {
          const i = (from + j) % n;
          if (!opts[i].disabled && opts[i].text.toLowerCase().indexOf(buffer) === 0) { choose(i); return; }
        }
      } else {
        const hit = visible().find((li) => li.textContent.toLowerCase().indexOf(buffer) === 0);
        if (hit) setActive(hit);
      }
    }

    function onKey(e) {
      const k = e.key;
      const plain = k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (!menu) {
        if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") { e.preventDefault(); open(); }
        else if (plain) typeahead(k, true);
        return;
      }
      if (k === "ArrowDown") { e.preventDefault(); move(1); }
      else if (k === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (k === "Home" && e.target === btn) { e.preventDefault(); setActive(visible()[0]); }
      else if (k === "End" && e.target === btn) { e.preventDefault(); const v = visible(); setActive(v[v.length - 1]); }
      else if (k === "Enter" || (k === " " && e.target === btn)) {
        e.preventDefault();
        const active = list.querySelector(".dd-active");
        if (active) choose(Number(active.dataset.i)); else close(true);
      }
      else if (k === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (k === "Tab") close(true);
      else if (plain && e.target === btn) typeahead(k, false);
    }

    btn.addEventListener("click", () => (menu ? close(true) : open()));
    btn.addEventListener("keydown", onKey);

    // Keep the label in step when code sets .value or .selectedIndex, or rebuilds the options.
    ["value", "selectedIndex"].forEach((prop) => {
      const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
      Object.defineProperty(select, prop, {
        configurable: true,
        get() { return desc.get.call(this); },
        set(v) { desc.set.call(this, v); sync(); }
      });
    });
    new MutationObserver(() => { sync(); close(false); }).observe(select, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "selected"]
    });

    sync();
  }

  document.addEventListener("mousedown", (e) => {
    if (openDd && !openDd.wrap.contains(e.target) && !openDd.menu().contains(e.target)) openDd.close(false);
  }, true);
  window.addEventListener("scroll", (e) => { if (openDd && !openDd.menu().contains(e.target)) openDd.close(false); }, true);
  window.addEventListener("resize", () => { if (openDd) openDd.close(false); });

  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.tagName === "SELECT") enhance(node);
    else node.querySelectorAll("select").forEach(enhance);
  }
  new MutationObserver((records) => {
    records.forEach((r) => r.addedNodes.forEach(scan));
    if (openDd && !openDd.wrap.isConnected) openDd.close(false);
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
})();
