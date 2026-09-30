const API_BASE_URL = "https://accident-admin-system.onrender.com/api";

function getToken() {
  return localStorage.getItem("adminToken");
}

function setToken(token) {
  localStorage.setItem("adminToken", token);
}

function clearToken() {
  localStorage.removeItem("adminToken");
  localStorage.removeItem("adminEmail");
}

function requireAuthOrRedirect() {
  if (!getToken()) {
    window.location.href = "login.html";
  }
}

async function apiRequest(path, options) {
  const opts = options || {};
  const headers = opts.headers || {};
  headers["Content-Type"] = "application/json";

  const token = getToken();
  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }

  const response = await fetch(API_BASE_URL + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });

  if (response.status === 401 && token) {
    clearToken();
    window.location.href = "login.html?reason=expired";
    throw new Error("Not authenticated");
  }

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = (data && data.error) || "Request failed";
    throw new Error(message);
  }

  return data;
}

const api = {
  login: (email, password) =>
    apiRequest("/auth/login", { method: "POST", body: { email, password } }),

  getVehicles: () => apiRequest("/vehicles"),
  getVehicle: (id) => apiRequest("/vehicles/" + id),
  createVehicle: (payload) => apiRequest("/vehicles", { method: "POST", body: payload }),
  updateVehicle: (id, payload) => apiRequest("/vehicles/" + id, { method: "PUT", body: payload }),
  deleteVehicle: (id) => apiRequest("/vehicles/" + id, { method: "DELETE" }),

  getVehicleContacts: (vehicleId) => apiRequest("/vehicles/" + vehicleId + "/contacts"),
  addVehicleContact: (vehicleId, payload) =>
    apiRequest("/vehicles/" + vehicleId + "/contacts", { method: "POST", body: payload }),
  updateContact: (id, payload) => apiRequest("/contacts/" + id, { method: "PUT", body: payload }),
  deleteContact: (id) => apiRequest("/contacts/" + id, { method: "DELETE" }),

  getEvents: (params) => {
    const query = new URLSearchParams(params || {}).toString();
    return apiRequest("/events" + (query ? "?" + query : ""));
  },
  getEvent: (id) => apiRequest("/events/" + id),
  updateEvent: (id, payload) => apiRequest("/events/" + id, { method: "PUT", body: payload }),

  getSimStatuses: () => apiRequest("/sim"),
  getSimStatus: (vehicleId) => apiRequest("/sim/" + vehicleId),
  markToppedUp: (vehicleId) => apiRequest("/sim/" + vehicleId + "/mark-topped-up", { method: "POST" }),

  getAlerts: () => apiRequest("/alerts")
};
