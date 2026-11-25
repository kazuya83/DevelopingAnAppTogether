// パスキー（WebAuthn）をブラウザで扱うための変換。iOS 16 の WKWebView でも動くように JSON 変換は自前で行う

const toBuf = (s) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
};

const toB64 = (buf) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const passkeySupported = () => typeof window.PublicKeyCredential === "function";

export function passkeyErrorMessage(e) {
  if (e?.name === "NotAllowedError" || e?.name === "AbortError") return null; // キャンセル
  if (e?.name === "InvalidStateError") return "この端末のパスキーはすでに登録されています";
  if (e?.name === "SecurityError") return "このドメインではパスキーを使えません（設定を確認してください）";
  return e?.message || "パスキーの処理に失敗しました";
}

export async function createPasskey(options) {
  const publicKey = {
    ...options,
    challenge: toBuf(options.challenge),
    user: { ...options.user, id: toBuf(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })),
  };
  const cred = await navigator.credentials.create({ publicKey });
  return {
    id: cred.id,
    rawId: toB64(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    response: {
      clientDataJSON: toB64(cred.response.clientDataJSON),
      attestationObject: toB64(cred.response.attestationObject),
      transports: cred.response.getTransports?.() ?? [],
    },
  };
}

export async function getPasskey(options) {
  const publicKey = {
    ...options,
    challenge: toBuf(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })),
  };
  const cred = await navigator.credentials.get({ publicKey });
  return {
    id: cred.id,
    rawId: toB64(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    response: {
      clientDataJSON: toB64(cred.response.clientDataJSON),
      authenticatorData: toB64(cred.response.authenticatorData),
      signature: toB64(cred.response.signature),
      userHandle: cred.response.userHandle ? toB64(cred.response.userHandle) : undefined,
    },
  };
}
