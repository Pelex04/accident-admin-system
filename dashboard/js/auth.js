const form = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorText = document.getElementById("errorText");
const loginButton = document.getElementById("loginButton");
const togglePassword = document.getElementById("togglePassword");

emailInput.focus();

togglePassword.addEventListener("click", () => {
  const show = passwordInput.type === "password";
  passwordInput.type = show ? "text" : "password";
  togglePassword.textContent = show ? "Hide" : "Show";
  togglePassword.setAttribute("aria-pressed", String(show));
});

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

  try {
    const result = await api.login(email, password);
    setToken(result.token);
    localStorage.setItem("adminEmail", result.admin.email);
    window.location.href = "index.html";
  } catch (err) {
    errorText.textContent = err.message || "Sign in failed. Check your details and try again.";
    loginButton.disabled = false;
    loginButton.textContent = "Sign in";
  }
});
