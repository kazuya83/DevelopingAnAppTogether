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
  if (e?.name === "AbortError") return null;
  if (e?.name === "NotAllowedError")
    return `パスキーの操作がキャンセルされたか、許可されませんでした。もう一度お試しください（詳細: ${e.message}）`;
  if (e?.name === "InvalidStateError") return "この端末のパスキーはすでに登録されています";
  if (e?.name === "SecurityError") return "このドメインではパスキーを使えません（アプリの設定を確認してください）";
  return e?.message || "パスキーの処理に失敗しました";
}

/**
 * パスキーのオプションを先に取っておく。
 * iOS の WKWebView は「ボタンを押した直後」でないとパスキーの画面を出さないので、
 * 押してからサーバーに問い合わせるのではなく、画面を開いた時点で取っておき、押したらすぐ使う。
 * チャレンジは 5 分で切れるので 4 分ごとに取り直す。
 */
export function prefetchOptions(fetcher, el) {
  let current = null;
  let pending = null;
  const load = () => {
    pending = fetcher()
      .then((data) => (current = { ...data, at: Date.now() }))
      .catch(() => (current = null))
      .finally(() => (pending = null));
    return pending;
  };
  load();
  // 画面から外れたら止める（描画直後は el がまだ DOM に無いので、一度表示されてから判定する）
  let shown = false;
  const timer = setInterval(() => {
    if (el.isConnected) shown = true;
    else if (shown) return clearInterval(timer);
    load();
  }, 4 * 60 * 1000);
  return {
    /** 使えるオプションを 1 回分取り出す（無ければ null）。取り出したら次の分を取りに行く */
    take() {
      const data = current && Date.now() - current.at < 4.5 * 60 * 1000 ? current : null;
      current = null;
      if (!pending) load();
      return data;
    },
    ready: () => pending ?? Promise.resolve(),
    stop: () => clearInterval(timer),
  };
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
