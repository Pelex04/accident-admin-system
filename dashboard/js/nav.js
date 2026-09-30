function renderSidebar(activePage) {
  const email = localStorage.getItem("adminEmail") || "Admin";

  const items = [
    { key: "overview", label: "Overview", href: "index.html" },
    { key: "vehicles", label: "Vehicles", href: "vehicles.html" },
    { key: "events", label: "Crash events", href: "events.html" },
    { key: "sim", label: "SIM status", href: "sim.html" },
    { key: "reports", label: "Reports", href: "reports.html" }
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
    "<div class=\"sidebar-brand\">" +
    "<div class=\"name\"><span class=\"accent\">Accident</span> Detection</div>" +
    "<div class=\"sub\">Admin</div>" +
    "</div>" +
    "<nav>" + linksHtml + "</nav>" +
    "<div class=\"sidebar-footer\">" +
    "<div class=\"who\">" + email + "</div>" +
    "<a href=\"#\" id=\"logoutLink\">Log out</a>" +
    "</div>";

  const layout = document.querySelector(".layout");
  layout.insertBefore(sidebar, layout.firstChild);

  document.getElementById("logoutLink").addEventListener("click", (event) => {
    event.preventDefault();
    clearToken();
    window.location.href = "login.html?reason=signedout";
  });
}
