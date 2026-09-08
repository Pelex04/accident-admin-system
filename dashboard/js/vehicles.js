requireAuthOrRedirect();
renderSidebar("vehicles");

let selectedVehicleId = null;

async function loadVehicles() {
  const tableBody = document.getElementById("vehiclesTableBody");

  try {
    const vehicles = await api.getVehicles();

    if (vehicles.length === 0) {
      tableBody.innerHTML = "<tr><td colspan=\"6\" class=\"muted\">No vehicles yet.</td></tr>";
      return;
    }

    const rows = await Promise.all(
      vehicles.map(async (vehicle) => {
        const contacts = await api.getVehicleContacts(vehicle.id);
        const statusBadge = vehicle.status === "active" ? "ok" : "warn";

        return (
          "<tr>" +
          "<td>" + vehicle.name + "</td>" +
          "<td>" + vehicle.arduinoSimNumber + "</td>" +
          "<td><span class=\"badge " + statusBadge + "\">" + vehicle.status + "</span></td>" +
          "<td>" + new Date(vehicle.registeredAt).toLocaleDateString() + "</td>" +
          "<td>" + contacts.length + "</td>" +
          "<td class=\"actions-cell\">" +
          "<button class=\"btn secondary\" data-action=\"contacts\" data-id=\"" + vehicle.id + "\" data-name=\"" + vehicle.name + "\">Contacts</button>" +
          "<button class=\"btn secondary\" data-action=\"toggle\" data-id=\"" + vehicle.id + "\" data-status=\"" + vehicle.status + "\">" +
          (vehicle.status === "active" ? "Deactivate" : "Activate") +
          "</button>" +
          "<button class=\"btn danger\" data-action=\"delete\" data-id=\"" + vehicle.id + "\">Delete</button>" +
          "</td>" +
          "</tr>"
        );
      })
    );

    tableBody.innerHTML = rows.join("");
    attachRowHandlers();
  } catch (err) {
    tableBody.innerHTML = "<tr><td colspan=\"6\" class=\"muted\">Could not load vehicles: " + err.message + "</td></tr>";
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
      loadVehicles();
    });
  });

  document.querySelectorAll("[data-action='delete']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Delete this vehicle and its contacts?")) {
        return;
      }
      await api.deleteVehicle(button.dataset.id);
      loadVehicles();
    });
  });
}

async function showContacts(vehicleId, vehicleName) {
  selectedVehicleId = vehicleId;
  document.getElementById("contactsCard").style.display = "block";
  document.getElementById("contactsTitle").textContent = "Contacts for " + vehicleName;
  await loadContacts();
}

async function loadContacts() {
  if (!selectedVehicleId) {
    return;
  }

  const tableBody = document.getElementById("contactsTableBody");

  try {
    const contacts = await api.getVehicleContacts(selectedVehicleId);

    if (contacts.length === 0) {
      tableBody.innerHTML = "<tr><td colspan=\"4\" class=\"muted\">No contacts yet.</td></tr>";
      return;
    }

    tableBody.innerHTML = contacts
      .map(
        (contact) =>
          "<tr>" +
          "<td>" + contact.name + "</td>" +
          "<td>" + contact.phoneNumber + "</td>" +
          "<td>" + contact.priority + "</td>" +
          "<td><button class=\"btn danger\" data-contact-id=\"" + contact.id + "\">Remove</button></td>" +
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
    tableBody.innerHTML = "<tr><td colspan=\"4\" class=\"muted\">Could not load contacts: " + err.message + "</td></tr>";
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
    await api.addVehicleContact(selectedVehicleId, { name, phoneNumber });
    document.getElementById("contactName").value = "";
    document.getElementById("contactPhone").value = "";
    loadContacts();
    loadVehicles();
  } catch (err) {
    contactError.textContent = err.message;
  }
});

loadVehicles();
