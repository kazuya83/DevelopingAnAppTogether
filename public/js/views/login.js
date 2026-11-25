import { api } from "../api.js";
import { go, refreshSession, session } from "../app.js";
import { busy, toast } from "../ui.js";
import { createPasskey, getPasskey, passkeyErrorMessage, passkeySupported } from "../webauthn.js";

function afterLogin() {
  const to = sessionStorage.getItem("returnTo");
  sessionStorage.removeItem("returnTo");
  go(to && to !== "#/login" ? to : "#/user");
}

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
      <form class="form" id="reg">
        <label>ユーザ名
          <input name="username" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false"
            pattern="[A-Za-z0-9_]{3,20}" maxlength="20" required placeholder="半角英数字と _ で 3〜20 文字" />
        </label>
        <p class="hint">ユーザ名はあとから変えられません（表示名はあとで自由に変えられます）。端末をなくしてもログインできるよう、iCloud キーチェーンを有効にしておくのがおすすめです。</p>
        <button class="btn block" type="submit">パスキーを作って登録</button>
      </form>
    </section>
    <p class="hint center">登録すると、投稿した提案・コメントが公開されることに同意したものとみなします。</p>`;

  el.querySelector("#login").addEventListener("click", (e) =>
    busy(e.currentTarget, async () => {
      try {
        const { flowId, options } = await api.post("/auth/login/options");
        const response = await getPasskey(options);
        await api.post("/auth/login/verify", { flowId, response });
        await refreshSession();
        toast(`ようこそ、${session.user.display_name} さん`);
        afterLogin();
      } catch (err) {
        toast(err.status ? err.message : passkeyErrorMessage(err));
      }
    }),
  );

  const form = el.querySelector("#reg");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(form.querySelector("button"), async () => {
      try {
        const username = new FormData(form).get("username");
        const { flowId, options } = await api.post("/auth/register/options", { username });
        const response = await createPasskey(options);
        await api.post("/auth/register/verify", { flowId, response });
        await refreshSession();
        toast("登録しました！");
        afterLogin();
      } catch (err) {
        toast(err.status ? err.message : passkeyErrorMessage(err));
      }
    });
  });
}
