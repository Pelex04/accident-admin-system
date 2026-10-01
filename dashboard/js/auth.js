const $ = (id) => document.getElementById(id);
const form = $("loginForm");
const emailInput = $("email");
const passwordInput = $("password");
const rememberBox = $("remember");
const errorText = $("errorText");
const loginButton = $("loginButton");
const trace = $("trace");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const EMAIL_KEY = "lastAdminEmail";
const serverState = { ready: false };

const params = new URLSearchParams(window.location.search);
const reason = params.get("reason");

// Already signed in: skip the form.
if (getToken() && !reason) {
  window.location.replace("index.html");
}

// Notice after being sent back here, then tidy the address bar.
const notices = {
  expired: "Your session expired. Sign in again to continue.",
  signedout: "You have signed out."
};
if (notices[reason]) {
  $("notice").textContent = notices[reason];
  $("notice").hidden = false;
  window.history.replaceState(null, "", "login.html");
}

// Remembered email.
const savedEmail = localStorage.getItem(EMAIL_KEY);
if (savedEmail) {
  emailInput.value = savedEmail;
  rememberBox.checked = true;
  passwordInput.focus();
} else {
  emailInput.focus();
}

// Show or hide password.
$("togglePassword").addEventListener("click", (event) => {
  const show = passwordInput.type === "password";
  passwordInput.type = show ? "text" : "password";
  event.currentTarget.textContent = show ? "Hide" : "Show";
  event.currentTarget.setAttribute("aria-pressed", String(show));
});

// Caps Lock warning.
function updateCaps(event) {
  if (event.getModifierState) {
    $("capsNote").hidden = !event.getModifierState("CapsLock");
  }
}
passwordInput.addEventListener("keydown", updateCaps);
passwordInput.addEventListener("keyup", updateCaps);
passwordInput.addEventListener("blur", () => { $("capsNote").hidden = true; });

// Server status. Hosting can sleep, so wake it while the person types.
function setStatus(state, text) {
  $("statusDot").dataset.state = state;
  $("statusText").textContent = text;
}
const WAKING_TEXT = "Waking the server, this can take up to a minute.";

async function checkServer() {
  setStatus("checking", "Checking the server...");
  const slow = setTimeout(() => {
    if (!serverState.ready) setStatus("waking", WAKING_TEXT);
  }, 3000);
  const controller = new AbortController();
  const giveUp = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(API_BASE_URL + "/health", { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error("unhealthy");
    serverState.ready = true;
    setStatus("ready", "Server is ready.");
  } catch (err) {
    setStatus("offline", "Can't reach the server. Check your connection, then reload the page.");
  } finally {
    clearTimeout(slow);
    clearTimeout(giveUp);
  }
}
checkServer();

// Trace reactions.
function jolt() {
  trace.classList.remove("alarm");
  void trace.getBoundingClientRect();
  trace.classList.add("alarm");
  setTimeout(() => trace.classList.remove("alarm"), 1100);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  errorText.textContent = "";

  if (!email || !password) {
    errorText.textContent = "Enter your email and password to sign in.";
    (email ? passwordInput : emailInput).focus();
    return;
  }

  loginButton.disabled = true;
  loginButton.textContent = "Signing in...";
  const slow = setTimeout(() => {
    if (!serverState.ready) setStatus("waking", WAKING_TEXT);
  }, 4000);

  try {
    const result = await api.login(email, password);
    serverState.ready = true;
    setToken(result.token);
    localStorage.setItem("adminEmail", result.admin.email);
    localStorage.setItem("adminRole", result.admin.role);
    if (rememberBox.checked) {
      localStorage.setItem(EMAIL_KEY, email);
    } else {
      localStorage.removeItem(EMAIL_KEY);
    }
    loginButton.textContent = "Signed in";
    trace.classList.add("ok");
    await delay(reduceMotion ? 0 : 750);
    window.location.href = result.admin.mustChangePassword ? "change-password.html?forced=1" : "index.html";
  } catch (err) {
    const offline = err instanceof TypeError;
    errorText.textContent = offline
      ? "Can't reach the server. Check your connection and try again."
      : err.message || "Sign in failed. Check your details and try again.";
    if (!offline) {
      serverState.ready = true;
      setStatus("ready", "Server is ready.");
    }
    jolt();
    passwordInput.select();
    loginButton.disabled = false;
    loginButton.textContent = "Sign in";
  } finally {
    clearTimeout(slow);
  }
});
