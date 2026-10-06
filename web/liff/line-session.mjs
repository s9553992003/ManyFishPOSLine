export async function startLineSession(liff, api, liffId) {
  await liff.init({ liffId });
  if (!liff.isLoggedIn()) {
    liff.login();
    return null;
  }
  const token = liff.getIDToken();
  if (!token) throw new Error("缺少 LINE ID token，請重新登入。");
  return api.openSession(token);
}
export async function loadLiff() {
  if (globalThis.liff) return globalThis.liff;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://static.line-scdn.net/liff/edge/2/sdk.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("無法載入 LINE 登入元件。"));
    document.head.append(script);
  });
  if (!globalThis.liff) throw new Error("LINE 登入元件不可用。");
  return globalThis.liff;
}
