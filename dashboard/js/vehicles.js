requireAuthOrRedirect();
renderSidebar("vehicles");

let selectedVehicleId = null;

async function loadVehicles() {
  const tableBody = document.getElementById("vehiclesTableBody");
  const vehicleCount = document.getElementById("vehicleCount");

  try {
    const vehicles = await api.getVehicles();
    vehicleCount.textContent = vehicles.length + (vehicles.length === 1 ? " vehicle" : " vehicles");

    if (vehicles.length === 0) {
      tableBody.innerHTML = "<tr class=\"empty-row\"><td colspan=\"6\">No vehicles yet. Add one below.</td></tr>";
      return;
    }

    const rows = await Promise.all(
      vehicles.map(async (vehicle) => {
        const contacts = await api.getVehicleContacts(vehicle.id);
        const isActive = vehicle.status === "active";

        return (
          "<tr data-id=\"" + esc(vehicle.id) + "\" data-ts=\"" + vehicle.registeredAt + "\">" +
          "<td><span class=\"dot " + (isActive ? "ok" : "neutral") + "\"></span>" + "<a href=\"vehicle.html?id=" + esc(vehicle.id) + "\">" + esc(vehicle.name) + "</a></td>" +
          "<td class=\"mono\">" + esc(vehicle.arduinoSimNumber) + "</td>" +
          "<td><span class=\"badge " + (isActive ? "ok" : "neutral") + "\">" + esc(vehicle.status) + "</span></td>" +
          "<td class=\"mono\" data-v=\"" + vehicle.registeredAt + "\">" + new Date(vehicle.registeredAt).toLocaleDateString() + "</td>" +
          "<td>" + contacts.length + "</td>" +
          "<td class=\"actions-cell\">" +
          "<button class=\"btn secondary\" data-action=\"contacts\" data-id=\"" + esc(vehicle.id) + "\" data-name=\"" + esc(vehicle.name) + "\">Contacts</button>" +
          "<button class=\"btn secondary\" data-action=\"toggle\" data-id=\"" + esc(vehicle.id) + "\" data-status=\"" + esc(vehicle.status) + "\">" +
          (isActive ? "Deactivate" : "Activate") +
          "</button>" +
          "<button class=\"btn danger\" data-action=\"delete\" data-id=\"" + esc(vehicle.id) + "\">Delete</button>" +
          "</td>" +
          "</tr>"
        );
      })
    );

    tableBody.innerHTML = rows.join("");
    attachRowHandlers();
  } catch (err) {
    tableBody.innerHTML = "<tr class=\"empty-row\"><td colspan=\"6\">Could not load vehicles: " + esc(err.message) + "</td></tr>";
  }
}

function attachRowHandlers() {
  document.querySelectorAll("[data-action='contacts']").forEach((button) => {
    button.addEventListener("click", () => showContacts(button.dataset.id, button.dataset.name));
  });

  document.querySelectorAll("[data-action='toggle']").forEach((button) => {
    button.addEventListener("click", async () => {
      const newStatus = button.dataset.status === "active" ? "inactive" : "active";
      await api.updateVehicle(button.dataset.id, { status: newStatus });
      toast(newStatus === "active" ? "Vehicle activated" : "Vehicle deactivated", "ok");
      loadVehicles();
    });
  });

  document.querySelectorAll("[data-action='delete']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmDialog("Delete this vehicle and its contacts?", "Delete"))) {
        return;
      }
      await api.deleteVehicle(button.dataset.id);
      toast("Vehicle deleted", "ok");
      if (selectedVehicleId === button.dataset.id) {
        document.getElementById("contactsSection").style.display = "none";
        selectedVehicleId = null;
      }
      loadVehicles();
    });
  });
}

function roleLabel(role) {
  return role === "dispatcher" ? "Medical dispatcher" : "Next of kin";
}

async function showContacts(vehicleId, vehicleName) {
  selectedVehicleId = vehicleId;
  document.getElementById("contactsSection").style.display = "block";
  document.getElementById("contactsTitle").textContent = "Contacts for " + vehicleName;
  await loadContacts();
  document.getElementById("contactsSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadContacts() {
  if (!selectedVehicleId) {
    return;
  }

  const tableBody = document.getElementById("contactsTableBody");

  try {
    const contacts = await api.getVehicleContacts(selectedVehicleId);

    if (contacts.length === 0) {
      tableBody.innerHTML = "<tr class=\"empty-row\"><td colspan=\"5\">No contacts yet.</td></tr>";
      return;
    }

    tableBody.innerHTML = contacts
      .map(
        (contact) =>
          "<tr>" +
          "<td>" + esc(contact.name) + "</td>" +
          "<td class=\"mono\">" + esc(contact.phoneNumber) + "</td>" +
          "<td>" + esc(contact.priority) + "</td>" +
          "<td>" + esc(roleLabel(contact.role)) + "</td>" +
          "<td><button class=\"btn danger\" data-contact-id=\"" + esc(contact.id) + "\">Remove</button></td>" +
          "</tr>"
      )
      .join("");

    document.querySelectorAll("[data-contact-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        await api.deleteContact(button.dataset.contactId);
        loadContacts();
        loadVehicles();
      });
    });
  } catch (err) {
    tableBody.innerHTML = "<tr class=\"empty-row\"><td colspan=\"5\">Could not load contacts: " + esc(err.message) + "</td></tr>";
  }
}

document.getElementById("addVehicleButton").addEventListener("click", async () => {
  const name = document.getElementById("newName").value.trim();
  const arduinoSimNumber = document.getElementById("newSim").value.trim();
  const addError = document.getElementById("addError");

  addError.textContent = "";

  if (!name || !arduinoSimNumber) {
    addError.textContent = "Name and SIM number are required.";
    return;
  }

  try {
    await api.createVehicle({ name, arduinoSimNumber });
    document.getElementById("newName").value = "";
    document.getElementById("newSim").value = "";
    loadVehicles();
  } catch (err) {
    addError.textContent = err.message;
  }
});

document.getElementById("addContactButton").addEventListener("click", async () => {
  const name = document.getElementById("contactName").value.trim();
  const phoneNumber = document.getElementById("contactPhone").value.trim();
  const contactError = document.getElementById("contactError");

  contactError.textContent = "";

  if (!name || !phoneNumber) {
    contactError.textContent = "Name and phone number are required.";
    return;
  }

  try {
    await api.addVehicleContact(selectedVehicleId, { name, phoneNumber, role: document.getElementById("contactRole").value });
    document.getElementById("contactName").value = "";
    document.getElementById("contactPhone").value = "";
    loadContacts();
    loadVehicles();
  } catch (err) {
    contactError.textContent = err.message;
  }
});

loadVehicles();

window.onLiveUpdate = loadVehicles;
