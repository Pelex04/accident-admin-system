requireAuthOrRedirect();
renderSidebar("admins");

const byId = (id) => document.getElementById(id);
const ROLES = [["viewer", "Viewer"], ["dispatcher", "Dispatcher"], ["admin", "Admin"], ["super_admin", "Super admin"]];
const roleLabel = (role) => (ROLES.find((r) => r[0] === role) || [role, role])[1];
let me = null;

function openModal(html) {
  const scrim = document.createElement("div");
  scrim.className = "modal-scrim";
  scrim.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + "</div>";
  const close = () => { document.removeEventListener("keydown", onKey); scrim.remove(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(scrim);
  return { scrim, close };
}

function showSecret(email, password) {
  const { scrim, close } = openModal(
    "<h2>Temporary password</h2>" +
    '<p class="muted">Give this to <b class="who"></b>. It is shown only once. They will be asked to choose their own password at first sign in.</p>' +
    '<div class="secret-box"></div>' +
    '<div class="modal-actions" style="margin-top:16px"><button type="button" class="btn secondary" data-copy>Copy</button><button type="button" class="btn" data-done>Done</button></div>'
  );
  scrim.querySelector(".who").textContent = email;
  scrim.querySelector(".secret-box").textContent = password;
  scrim.querySelector("[data-done]").addEventListener("click", close);
  scrim.querySelector("[data-copy]").addEventListener("click", async (e) => {
    try { await navigator.clipboard.writeText(password); e.target.textContent = "Copied"; }
    catch (err) { e.target.textContent = "Select it and copy by hand"; }
  });
}

async function loadAdmins() {
  const body = byId("adminsBody");
  try {
    const [admins, self] = await Promise.all([api.getAdmins(), api.me()]);
    me = self;

    body.innerHTML = admins
      .map((a) => {
        const own = a.id === self.id;
        const id = esc(a.id);
        return (
          '<tr data-id="' + id + '"><td>' + esc(a.email) + (own ? ' <span class="badge neutral">you</span>' : "") +
          (a.mustChangePassword ? ' <span class="badge warn">must change password</span>' : "") + "</td>" +
          '<td><select data-role-id="' + id + '"' + (own ? " disabled" : "") + ">" +
          ROLES.map((r) => '<option value="' + r[0] + '"' + (r[0] === a.role ? " selected" : "") + ">" + r[1] + "</option>").join("") + "</select></td>" +
          '<td><span class="badge ' + (a.active ? "ok" : "neutral") + '">' + (a.active ? "active" : "deactivated") + "</span></td>" +
          '<td class="mono" data-v="' + esc(a.lastLoginAt || "") + '">' + (a.lastLoginAt ? esc(new Date(a.lastLoginAt).toLocaleString()) : "Never") + "</td>" +
          '<td class="actions-cell">' + (own ? "" :
            '<button class="btn secondary" data-act="reset" data-id="' + id + '" data-email="' + esc(a.email) + '">Reset password</button>' +
            '<button class="btn secondary" data-act="toggle" data-id="' + id + '" data-active="' + (a.active ? "1" : "0") + '">' + (a.active ? "Deactivate" : "Activate") + "</button>" +
            '<button class="btn danger" data-act="delete" data-id="' + id + '" data-email="' + esc(a.email) + '">Delete</button>') +
          "</td></tr>"
        );
      })
      .join("");
  } catch (err) {
    body.innerHTML = '<tr class="empty-row"><td colspan="5">Could not load admins: ' + esc(err.message) + "</td></tr>";
  }
}

async function run(action, success) {
  try {
    const result = await action();
    if (success) toast(success, "ok");
    return result;
  } catch (err) {
    toast(err.message, "danger");
    return null;
  } finally {
    loadAdmins();
  }
}

function init() {
  enhanceTable(byId("adminsBody").closest("table"), { name: "admins" });
  const body = byId("adminsBody");

  body.addEventListener("change", (e) => {
    const select = e.target.closest("select[data-role-id]");
    if (select) run(() => api.updateAdmin(select.dataset.roleId, { role: select.value }), "Role updated");
  });

  body.addEventListener("click", async (e) => {
    const button = e.target.closest("button[data-act]");
    if (!button) return;
    const id = button.dataset.id;

    if (button.dataset.act === "toggle") {
      const active = button.dataset.active === "1";
      run(() => api.updateAdmin(id, { active: !active }), active ? "Admin deactivated" : "Admin activated");
    } else if (button.dataset.act === "reset") {
      if (!(await confirmDialog("Reset the password for " + button.dataset.email + "? Their current sessions will end.", "Reset"))) return;
      const result = await run(() => api.resetAdminPassword(id));
      if (result) showSecret(button.dataset.email, result.temporaryPassword);
    } else if (button.dataset.act === "delete") {
      if (!(await confirmDialog("Delete " + button.dataset.email + "? This cannot be undone.", "Delete"))) return;
      run(() => api.deleteAdmin(id), "Admin deleted");
    }
  });

  byId("addAdmin").addEventListener("click", () => {
    const { scrim, close } = openModal(
      "<h2>Add admin</h2>" +
      '<label for="newEmail">Email</label><input type="email" id="newEmail" autocomplete="off" placeholder="name@example.com">' +
      '<label for="newRole">Role</label><select id="newRole">' + ROLES.map((r) => '<option value="' + r[0] + '"' + (r[0] === "admin" ? " selected" : "") + ">" + r[1] + "</option>").join("") + "</select>" +
      '<div class="error-text" id="newError" role="alert" style="margin-top:10px"></div>' +
      '<div class="modal-actions"><button type="button" class="btn secondary" data-cancel>Cancel</button><button type="button" class="btn" data-create>Create admin</button></div>'
    );
    const email = scrim.querySelector("#newEmail");
    email.focus();
    scrim.querySelector("[data-cancel]").addEventListener("click", close);
    scrim.querySelector("[data-create]").addEventListener("click", async (e) => {
      const error = scrim.querySelector("#newError");
      error.textContent = "";
      e.target.disabled = true;
      try {
        const result = await api.createAdmin({ email: email.value.trim(), role: scrim.querySelector("#newRole").value });
        close();
        showSecret(result.admin.email, result.temporaryPassword);
        loadAdmins();
      } catch (err) {
        error.textContent = err.message;
        e.target.disabled = false;
      }
    });
  });

  loadAdmins();
}

if (localStorage.getItem("adminRole") !== "super_admin") {
  byId("adminsRoot").innerHTML = '<div class="empty-state">Only super admins can manage admins.</div>';
  byId("addAdmin").hidden = true;
} else {
  init();
}
