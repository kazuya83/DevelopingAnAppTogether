import { api } from "./api.js";
import { syncPushToken } from "./push.js";
import { esc, loading, toast } from "./ui.js";
import { discussList, discussNew, discussDetail, contributors } from "./views/discuss.js";
import { userHome, userEdit, userSettings, userProfile } from "./views/user.js";
import { loginView } from "./views/login.js";

/** ログイン中のユーザなど、画面をまたいで使う状態 */
export const session = { user: null, isAdmin: false, threshold: 5, loaded: false };

export async function refreshSession() {
  const data = await api.get("/me");
  Object.assign(session, data, { loaded: true });
  syncPushToken(session.user); // iOS アプリで通知を許可済みなら、この端末を登録し直す
  return session;
}

const view = document.getElementById("view");

export function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

/** ログインが必要な操作の前に呼ぶ。ログインしていなければログイン画面へ */
export function requireLogin() {
  if (session.user) return true;
  sessionStorage.setItem("returnTo", location.hash || "#/discuss");
  go("#/login");
  return false;
}

const routes = [
  [/^#\/main$/, "main", mainView],
  [/^#\/discuss$/, "discuss", discussList],
  [/^#\/discuss\/new$/, "discuss", discussNew],
  [/^#\/discuss\/(\d+)$/, "discuss", discussDetail],
  [/^#\/contributors$/, "discuss", contributors],
  [/^#\/login$/, "user", loginView],
  [/^#\/user$/, "user", userHome],
  [/^#\/user\/edit$/, "user", userEdit],
  [/^#\/user\/settings$/, "user", userSettings],
  [/^#\/users\/([\w-]+)$/, "user", userProfile],
];

function mainView(el) {
  // メインはこれからみんなで作っていく場所。いまは「hope」を大きく表示する
  el.innerHTML = `<div class="main-hope">hope</div>`;
}

let renderSeq = 0;

async function render() {
  const hash = location.hash || "#/main";
  const seq = ++renderSeq;
  const match = routes.find(([re]) => re.test(hash));
  if (!match) return go("#/main");
  const [re, tab, fn] = match;
  for (const a of document.querySelectorAll("#tabbar a")) a.classList.toggle("active", a.dataset.tab === tab);

  if (!session.loaded) {
    try {
      await refreshSession();
    } catch (e) {
      view.innerHTML = `<div class="page"><div class="empty">${esc(e.message)}<br /><button class="btn" id="retry">再読み込み</button></div></div>`;
      view.querySelector("#retry").onclick = () => render();
      return;
    }
  }

  const container = document.createElement("div");
  container.className = "page";
  // 画面を描き終わる前に別の画面へ移ったら、古い描画は捨てる
  const isCurrent = () => seq === renderSeq;
  // 読み込みに時間がかかるときだけくるくるを出す
  const spinner = setTimeout(() => isCurrent() && (view.innerHTML = loading()), 250);
  try {
    await fn(container, ...(hash.match(re).slice(1)), isCurrent);
  } catch (e) {
    if (!isCurrent()) return;
    if (e.status === 401) {
      session.user = null;
      requireLogin();
      return;
    }
    container.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  } finally {
    clearTimeout(spinner);
  }
  if (!isCurrent()) return;
  view.replaceChildren(container);
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", render);

// 同じタブをもう一度押したら、そのタブの最初の画面に戻る
document.getElementById("tabbar").addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (a && location.hash === a.getAttribute("href")) {
    e.preventDefault();
    render();
  }
});

// 「戻る」ボタン（履歴が無ければ議論へ）
document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-back]")) return;
  if (history.length > 1) history.back();
  else go("#/discuss");
});

window.addEventListener("unhandledrejection", (e) => toast(e.reason?.message));

render();
