export class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
class JsonApi {
  constructor(fetchImpl = globalThis.fetch.bind(globalThis)) {
    this.fetch = fetchImpl;
  }
  async request(path, method = "GET", body, headers = {}) {
    const options = {
      method,
      credentials: "same-origin",
      headers: { Accept: "application/json", ...headers },
    };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const response = await this.fetch(path, options);
    const data = await response.json();
    if (!response.ok)
      throw new ApiError(response.status, data.error ?? "INVALID_RESPONSE");
    return data;
  }
}
export class CustomerApi extends JsonApi {
  async openSession(idToken) {
    const session = await this.request("/v1/customer/sessions", "POST", {
      idToken,
    });
    this.csrfToken = session.csrfToken;
    this.recoveryScope = session.recoveryScope;
    return session;
  }
  config() {
    return this.request("/v1/customer/config");
  }
  defaults() {
    return this.request("/v1/customer/defaults");
  }
  menu() {
    return this.request("/v1/customer/menu");
  }
  pickupSlots() {
    return this.request("/v1/customer/pickup-slots");
  }
  placeOrder(request, clientOrderKey) {
    return this.request(
      "/v1/customer/orders",
      "POST",
      { ...request, clientOrderKey },
      { "X-CSRF-Token": this.csrfToken ?? "" },
    );
  }
  orders() {
    return this.request("/v1/customer/orders");
  }
  order(id) {
    return this.request(`/v1/customer/orders/${encodeURIComponent(id)}`);
  }
  orderByClientKey(key) {
    return this.request(
      `/v1/customer/orders/by-client-key/${encodeURIComponent(key)}`,
    );
  }
}
export class AdminApi extends JsonApi {
  setToken(token) {
    this.token = token.trim();
  }
  admin(path, method = "GET", body) {
    return this.request(`/v1/admin/${path}`, method, body, {
      Authorization: `Bearer ${this.token ?? ""}`,
    });
  }
  schedule() {
    return this.admin("pickup-schedule");
  }
  saveSchedule(schedule) {
    return this.admin("pickup-schedule", "PUT", schedule);
  }
  pickupSlots() {
    return this.admin("pickup-slots");
  }
  previewSchedule(schedule) {
    return this.admin("pickup-slots", "POST", schedule);
  }
  orderingState() {
    return this.admin("ordering");
  }
  orders() {
    return this.admin("orders");
  }
  ordering(enabled) {
    return this.admin("ordering", "PATCH", { enabled });
  }
}
