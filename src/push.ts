import type { Env } from "./types";

/**
 * iOS アプリへの通知（APNs）。Cloudflare Workers から APNs の HTTP/2 API に直接送る。
 * 鍵（.p8）は `wrangler secret put APNS_KEY`、鍵の ID は APNS_KEY_ID に入れる。どちらも無ければ何もしない。
 */
export interface PushMessage {
  title: string;
  body: string;
  /** 通知を押したときに開く画面（例: #/discuss/3） */
  path?: string;
}

let cachedJwt: { token: string; at: number; kid: string } | null = null;

function base64url(bytes: Uint8Array | string): string {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** APNs の認証トークン（ES256 の JWT）。1 時間まで使えるので 50 分ごとに作り直す */
async function providerToken(env: Env): Promise<string> {
  const keyId = env.APNS_KEY_ID!;
  if (cachedJwt && cachedJwt.kid === keyId && Date.now() - cachedJwt.at < 50 * 60 * 1000) return cachedJwt.token;
  const pem = env.APNS_KEY!.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${claims}`));
  const token = `${head}.${claims}.${base64url(new Uint8Array(sig))}`;
  cachedJwt = { token, at: Date.now(), kid: keyId };
  return token;
}

export function pushEnabled(env: Env): boolean {
  return Boolean(env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_TOPIC);
}

/** ユーザのすべての端末に通知を送る。失敗しても例外は投げない（本来の処理を止めない） */
export async function notifyUser(env: Env, userId: string | null | undefined, msg: PushMessage): Promise<void> {
  if (!userId || !pushEnabled(env)) return;
  try {
    const { results } = await env.DB.prepare("SELECT token, env FROM push_tokens WHERE user_id = ?")
      .bind(userId)
      .all<{ token: string; env: string }>();
    if (!results.length) return;
    const jwt = await providerToken(env);
    const payload = JSON.stringify({
      aps: { alert: { title: msg.title, body: msg.body }, sound: "default" },
      path: msg.path ?? "",
    });
    await Promise.all(
      results.map(async (t) => {
        const host = t.env === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
        const res = await fetch(`https://${host}/3/device/${t.token}`, {
          method: "POST",
          headers: {
            authorization: `bearer ${jwt}`,
            "apns-topic": env.APNS_TOPIC!,
            "apns-push-type": "alert",
            "apns-priority": "10",
            "content-type": "application/json",
          },
          body: payload,
        });
        if (res.ok) return;
        const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason ?? "";
        // アプリを消した・別の環境のトークンなど、もう届かない宛先は消す
        if (res.status === 410 || ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"].includes(reason)) {
          await env.DB.prepare("DELETE FROM push_tokens WHERE token = ?").bind(t.token).run();
        } else {
          console.error(`通知を送れませんでした: APNs ${res.status} ${reason}`);
        }
      }),
    );
  } catch (e) {
    console.error("通知を送れませんでした", e);
  }
}
