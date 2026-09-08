document.getElementById("loginButton").addEventListener("click", async () => {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const errorText = document.getElementById("errorText");

  errorText.textContent = "";

  if (!email || !password) {
    errorText.textContent = "Email and password are required.";
    return;
  }

  try {
    const result = await api.login(email, password);
    setToken(result.token);
    localStorage.setItem("adminEmail", result.admin.email);
    window.location.href = "index.html";
  } catch (err) {
    errorText.textContent = err.message || "Login failed.";
  }
});

document.getElementById("password").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    document.getElementById("loginButton").click();
  }
});
