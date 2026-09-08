requireAuthOrRedirect();
renderSidebar("sim");

const STALE_THRESHOLD_MINUTES = 720; // matches heartbeatStaleMinutes in server/src/config.js

function minutesSince(isoString) {
  if (!isoString) {
    return Infinity;
  }
  return (Date.now() - new Date(isoString).getTime()) / 60000;
}

async function loadSimStatuses() {
  const tableBody = document.getElementById("simTableBody");

  try {
    const [statuses, vehicles] = await Promise.all([api.getSimStatuses(), api.getVehicles()]);

    if (vehicles.length === 0) {
      tableBody.innerHTML = "<tr><td colspan=\"5\" class=\"muted\">No vehicles registered yet.</td></tr>";
      return;
    }

    tableBody.innerHTML = vehicles
      .map((vehicle) => {
        const status = statuses.find((s) => s.vehicleId === vehicle.id);

        if (!status) {
          return (
            "<tr>" +
            "<td>" + vehicle.name + "</td>" +
            "<td class=\"muted\">Never checked in</td>" +
            "<td class=\"muted\">No data</td>" +
            "<td><span class=\"badge warn\">unknown</span></td>" +
            "<td></td>" +
            "</tr>"
          );
        }

        const stale = minutesSince(status.lastHeartbeatAt) > STALE_THRESHOLD_MINUTES;
        let badge = "<span class=\"badge ok\">ok</span>";

        if (status.lowBalanceFlag) {
          badge = "<span class=\"badge danger\">low balance</span>";
        } else if (stale) {
          badge = "<span class=\"badge warn\">no recent check in</span>";
        }

        const action = status.lowBalanceFlag
          ? "<button class=\"btn secondary\" data-vehicle-id=\"" + vehicle.id + "\">Mark topped up</button>"
          : "";

        return (
          "<tr>" +
          "<td>" + vehicle.name + "</td>" +
          "<td>" + new Date(status.lastHeartbeatAt).toLocaleString() + "</td>" +
          "<td>" + (status.lastKnownBalanceText || "") + "</td>" +
          "<td>" + badge + "</td>" +
          "<td>" + action + "</td>" +
          "</tr>"
        );
      })
      .join("");

    document.querySelectorAll("[data-vehicle-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        await api.markToppedUp(button.dataset.vehicleId);
        loadSimStatuses();
      });
    });
  } catch (err) {
    tableBody.innerHTML = "<tr><td colspan=\"5\" class=\"muted\">Could not load sim status: " + err.message + "</td></tr>";
  }
}

loadSimStatuses();
