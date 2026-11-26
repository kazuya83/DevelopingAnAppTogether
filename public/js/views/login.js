import { api } from "../api.js";
import { go, refreshSession, session } from "../app.js";
import { busy, esc, toast } from "../ui.js";
import { icon } from "../icons.js";
import { createPasskey, getPasskey, passkeyErrorMessage, passkeySupported, prefetchOptions } from "../webauthn.js";

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

function afterLogin() {
  const to = sessionStorage.getItem("returnTo");
  sessionStorage.removeItem("returnTo");
  go(to && to !== "#/login" ? to : "#/user");
}

const NOT_READY = "準備中です。少し待ってからもう一度押してください";

export async function loginView(el) {
  if (session.user) return go("#/user");
  el.innerHTML = `
    <h1>ログイン</h1>
    <p class="lead">このアプリはパスワードを使わず、<b>パスキー</b>（Face ID / Touch ID）でログインします。</p>
    ${passkeySupported() ? "" : `<div class="warn">この環境ではパスキーを使えません。iOS 16 以降の端末で開いてください。</div>`}

    <section class="panel">
      <h2>アカウントをお持ちの方</h2>
      <button class="btn primary block" id="login">パスキーでログイン</button>
    </section>

    <section class="panel">
      <h2>はじめての方</h2>
      <form class="form" id="reg" novalidate>
        <label>ユーザ名
          <input name="username" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false"
            maxlength="20" placeholder="半角英数字と _ で 3〜20 文字" />
        </label>
        <p class="hint" id="name-status">ユーザ名はあとから変えられません（表示名はあとで自由に変えられます）。端末をなくしてもログインできるよう、iCloud キーチェーンを有効にしておくのがおすすめです。</p>
        <button class="btn block" type="submit">パスキーを作って登録</button>
      </form>
    </section>
    <p class="hint center">登録すると、投稿した提案・コメントが公開されることに同意したものとみなします。</p>`;

  // パスキーは「押した直後」に呼ぶ必要があるので、サーバーからのオプションは先に取っておく
  const loginOpts = prefetchOptions(() => api.post("/auth/login/options"), el);
  const regOpts = prefetchOptions(() => api.post("/auth/register/options"), el);

  el.querySelector("#login").addEventListener("click", (e) => {
    const prepared = loginOpts.take();
    if (!prepared) return toast(NOT_READY);
    busy(e.currentTarget, async () => {
      try {
        const response = await getPasskey(prepared.options); // await より前に呼ばれるので「押した直後」になる
        await api.post("/auth/login/verify", { flowId: prepared.flowId, response });
        await refreshSession();
        toast(`ようこそ、${session.user.display_name} さん`);
        afterLogin();
      } catch (err) {
        toast(err.status ? err.message : passkeyErrorMessage(err));
      }
    });
  });

  // ユーザ名が使えるかを入力中に確かめる（押したあとに問い合わせるとパスキーが出せなくなるため）
  const form = el.querySelector("#reg");
  const input = form.elements.username;
  const status = el.querySelector("#name-status");
  const defaultHint = status.innerHTML;
  let checked = { name: "", ok: false, error: "" };
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const name = input.value.trim();
    checked = { name: "", ok: false, error: "" };
    if (!name) return (status.innerHTML = defaultHint);
    if (!USERNAME_RE.test(name)) return (status.textContent = "半角英数字と _ で 3〜20 文字にしてください");
    status.textContent = "確認中…";
    timer = setTimeout(async () => {
      try {
        const r = await api.get(`/auth/username-available?username=${encodeURIComponent(name)}`);
        if (input.value.trim() !== name) return;
        checked = { name, ok: r.available, error: r.error ?? "" };
        status.innerHTML = r.available ? `${icon("check", { size: 16, cls: "ok" })}<b>${esc(name)}</b> は使えます` : esc(r.error);
      } catch (err) {
        status.textContent = err.message;
      }
    }, 300);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const username = input.value.trim();
    if (!USERNAME_RE.test(username)) return toast("ユーザ名は半角英数字と _ で 3〜20 文字にしてください");
    if (checked.name === username && !checked.ok) return toast(checked.error || "このユーザ名は使えません");
    const prepared = regOpts.take();
    if (!prepared) return toast(NOT_READY);
    const options = { ...prepared.options, user: { ...prepared.options.user, name: username, displayName: username } };
    busy(form.querySelector("button"), async () => {
      try {
        const response = await createPasskey(options); // await より前に呼ばれるので「押した直後」になる
        await api.post("/auth/register/verify", { flowId: prepared.flowId, response, username });
        await refreshSession();
        toast("登録しました！");
        afterLogin();
      } catch (err) {
        toast(err.status ? err.message : passkeyErrorMessage(err));
      }
    });
  });
}
