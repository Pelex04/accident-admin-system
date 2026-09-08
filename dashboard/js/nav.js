function renderSidebar(activePage) {
  const email = localStorage.getItem("adminEmail") || "Admin";

  const items = [
    { key: "overview", label: "Overview", href: "index.html" },
    { key: "vehicles", label: "Vehicles", href: "vehicles.html" },
    { key: "events", label: "Crash events", href: "events.html" },
    { key: "sim", label: "SIM status", href: "sim.html" }
  ];

  const linksHtml = items
    .map((item) => {
      const activeClass = item.key === activePage ? " class=\"active\"" : "";
      return "<a href=\"" + item.href + "\"" + activeClass + ">" + item.label + "</a>";
    })
    .join("");

  const sidebar = document.createElement("div");
  sidebar.className = "sidebar";
  sidebar.innerHTML =
    "<h1>Accident Detection Admin</h1>" +
    "<nav>" + linksHtml + "</nav>" +
    "<div class=\"logout\">" +
    "<div class=\"muted\" style=\"padding: 0 20px 8px 20px\">" + email + "</div>" +
    "<a href=\"#\" id=\"logoutLink\">Log out</a>" +
    "</div>";

  document.body.insertBefore(sidebar, document.body.firstChild);

  document.getElementById("logoutLink").addEventListener("click", (event) => {
    event.preventDefault();
    clearToken();
    window.location.href = "login.html";
  });
}
