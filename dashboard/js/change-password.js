requireAuthOrRedirect();

const byId = (id) => document.getElementById(id);
const forced = new URLSearchParams(window.location.search).get("forced") === "1";

if (forced) {
  byId("forcedNotice").hidden = false;
  byId("cancelLink").hidden = true;
}

byId("signOut").addEventListener("click", (event) => {
  event.preventDefault();
  clearToken();
  window.location.href = "login.html?reason=signedout";
});

byId("pwForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = byId("errorText");
  const button = byId("pwButton");
  const current = byId("currentPassword").value;
  const next = byId("newPassword").value;
  error.textContent = "";

  if (!current || !next) { error.textContent = "Fill in every field."; return; }
  if (next !== byId("confirmPassword").value) { error.textContent = "The new passwords do not match."; byId("confirmPassword").focus(); return; }
  if (next.length < 10) { error.textContent = "The new password must be at least 10 characters."; byId("newPassword").focus(); return; }

  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const result = await api.changePassword(current, next);
    setToken(result.token);
    localStorage.setItem("adminRole", result.admin.role);
    button.textContent = "Saved";
    window.location.href = "index.html";
  } catch (err) {
    error.textContent = err.message;
    button.disabled = false;
    button.textContent = "Save new password";
  }
});
