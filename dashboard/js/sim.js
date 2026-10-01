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
      tableBody.innerHTML = '<tr class="empty-row"><td colspan="5">No vehicles registered yet.</td></tr>';
      return;
    }

    tableBody.innerHTML = vehicles
      .map((vehicle) => {
        const status = statuses.find((s) => s.vehicleId === vehicle.id);
        const name = esc(vehicle.name);

        if (!status) {
          return (
            '<tr><td><span class="dot neutral"></span>' + name + "</td>" +
            '<td class="muted">Never checked in</td><td class="muted">No data</td>' +
            '<td><span class="badge neutral">unknown</span></td><td></td></tr>'
          );
        }

        const stale = minutesSince(status.lastHeartbeatAt) > STALE_THRESHOLD_MINUTES;
        let dot = "ok";
        let badge = '<span class="badge ok">ok</span>';

        if (status.lowBalanceFlag) {
          dot = "danger";
          badge = '<span class="badge danger">low balance</span>';
        } else if (stale) {
          dot = "warn";
          badge = '<span class="badge warn">no recent check in</span>';
        }

        const action = status.lowBalanceFlag
          ? '<button class="btn secondary" data-vehicle-id="' + esc(vehicle.id) + '">Mark topped up</button>'
          : "";

        return (
          '<tr><td><span class="dot ' + dot + '"></span>' + name + "</td>" +
          '<td class="mono" data-v="' + esc(status.lastHeartbeatAt || "") + '">' +
          (status.lastHeartbeatAt ? esc(new Date(status.lastHeartbeatAt).toLocaleString()) : "Never") + "</td>" +
          '<td class="mono">' + esc(status.lastKnownBalanceText || "\u2014") + "</td>" +
          "<td>" + badge + "</td><td>" + action + "</td></tr>"
        );
      })
      .join("");

    document.querySelectorAll("[data-vehicle-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await api.markToppedUp(button.dataset.vehicleId);
          toast("Marked as topped up", "ok");
        } catch (err) {
          toast(err.message, "danger");
        }
        loadSimStatuses();
      });
    });
  } catch (err) {
    tableBody.innerHTML = '<tr class="empty-row"><td colspan="5">Could not load sim status: ' + esc(err.message) + "</td></tr>";
  }
}

loadSimStatuses();

window.onLiveUpdate = loadSimStatuses;
