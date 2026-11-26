// iOS アプリの通知。アプリの中（WKWebView）でだけ使える。ブラウザでは何もしない。
import { api } from "./api.js";

const bridge = () => window.webkit?.messageHandlers?.push;

/** アプリの中で開いているか */
export const pushSupported = () => Boolean(bridge());

/** { authorization: "authorized" | "denied" | "notDetermined", token, env } */
export async function pushStatus() {
  if (!bridge()) return null;
  try {
    return await bridge().postMessage({ action: "status" });
  } catch {
    return null;
  }
}

/** 通知を許可してもらい、この端末を登録する。許可されなければ false */
export async function enablePush() {
  if (!bridge()) return false;
  try {
    const { token, env } = await bridge().postMessage({ action: "enable" });
    await api.post("/me/push-token", { token, env });
    return true;
  } catch {
    return false;
  }
}

export function openPushSettings() {
  bridge()?.postMessage({ action: "openSettings" }).catch(() => {});
}

/** ログインしているとき、許可済みならこの端末を登録し直す（トークンが変わることがあるため。1 回だけ） */
let synced = false;
export async function syncPushToken(user) {
  if (!user || synced || !bridge()) return;
  const s = await pushStatus();
  if (s?.authorization !== "authorized" || !s.token) return;
  synced = true;
  await api.post("/me/push-token", { token: s.token, env: s.env }).catch(() => {
    synced = false;
  });
}

/** ログアウトの前に、この端末への通知を止める */
export async function unregisterPush() {
  const s = await pushStatus();
  synced = false;
  if (s?.token) await api.del(`/me/push-token/${encodeURIComponent(s.token)}`).catch(() => {});
}
