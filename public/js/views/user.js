import { api } from "../api.js";
import { go, refreshSession, session } from "../app.js";
import { actionSheet, avatar, busy, empty, esc, formatDate, proposalCard, timeAgo, toast } from "../ui.js";
import { createPasskey, passkeyErrorMessage } from "../webauthn.js";
import { loginView } from "./login.js";
import { block, report } from "./discuss.js";

const DAY = 24 * 60 * 60 * 1000;
const JST = 9 * 60 * 60 * 1000;

/** GitHub の草のような、直近 12 週間の活動（提案＋コメント） */
function heatmap(activity) {
  const nowJst = new Date(Date.now() + JST);
  const total = 11 * 7 + nowJst.getUTCDay(); // 11 週前の日曜日から今日まで
  let cells = "";
  let sum = 0;
  for (let i = total; i >= 0; i--) {
    const key = new Date(Date.now() - i * DAY + JST).toISOString().slice(0, 10);
    const n = activity[key] ?? 0;
    sum += n;
    const level = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4;
    cells += `<span class="cell l${level}" title="${key}: ${n}"></span>`;
  }
  return `<div class="heatmap-wrap">
    <div class="heatmap">${cells}</div>
    <div class="muted small">直近 12 週間で ${sum} 回の提案・コメント</div>
  </div>`;
}

function stats(u) {
  const items = [
    ["貢献スコア", u.score, "score"],
    ["提案", u.proposal_count],
    ["Issue 化", u.issued_count],
    ["コメント", u.comment_count],
    ["もらったいいね", u.likes_received],
  ];
  return `<div class="stats">${items
    .map(([label, n, cls]) => `<div class="stat-tile ${cls ?? ""}"><b>${n}</b><span>${label}</span></div>`)
    .join("")}</div>`;
}

function commentItem(cm) {
  const text = cm.body.length > 120 ? cm.body.slice(0, 120) + "…" : cm.body;
  return `<a class="card" href="#/discuss/${cm.proposal_id}">
    <div class="muted small">「${esc(cm.proposal_title)}」へのコメント・${timeAgo(cm.created_at)}</div>
    <div class="clip">${esc(text)}</div>
  </a>`;
}

/** プロフィール（自分・他人共通）。tabs で表示する一覧を切り替える */
async function renderProfile(el, id, { self }) {
  const [data, likes] = await Promise.all([
    api.get(`/users/${encodeURIComponent(id)}`),
    self ? api.get("/me/likes") : Promise.resolve(null),
  ]);
  const u = data.user;
  const tabs = [
    ["proposals", `提案 ${data.proposals.length}`],
    ["comments", `コメント ${data.comments.length}`],
  ];
  if (likes) tabs.push(["likes", `いいね ${likes.proposals.length}`]);

  el.innerHTML = `
    <header class="page-header">
      ${self ? `<h1>ユーザ</h1><a class="icon-btn" href="#/user/settings" aria-label="設定">⚙︎</a>` : `<button class="back" data-back>‹ 戻る</button>${session.user && !data.isMe ? `<button class="icon-btn" id="menu" aria-label="メニュー">⋯</button>` : ""}`}
    </header>
    <section class="profile">
      ${avatar(u, 72)}
      <div>
        <div class="profile-name">${esc(u.display_name)}</div>
        <div class="muted">@${esc(u.username)}・${formatDate(u.created_at)} から参加</div>
        ${data.blocked ? `<div class="badge creating">ブロック中</div>` : ""}
      </div>
    </section>
    ${self ? `<div class="row-buttons"><a class="btn small" href="#/user/edit">プロフィールを編集</a><a class="btn small" href="#/contributors">🏆 ランキング</a></div>` : ""}
    ${stats(u)}
    ${heatmap(data.activity)}
    <div class="segmented" id="tabs">${tabs.map(([k, label], i) => `<button data-k="${k}" class="${i === 0 ? "active" : ""}">${label}</button>`).join("")}</div>
    <div class="list" id="tab-body"></div>`;

  const body = el.querySelector("#tab-body");
  const show = (k) => {
    if (k === "proposals")
      body.innerHTML = data.proposals.length
        ? data.proposals.map((p) => proposalCard(p, session.threshold)).join("")
        : empty("まだ提案はありません");
    else if (k === "comments")
      body.innerHTML = data.comments.length ? data.comments.map(commentItem).join("") : empty("まだコメントはありません");
    else
      body.innerHTML = likes.proposals.length
        ? likes.proposals.map((p) => proposalCard({ ...p, liked: 1 }, session.threshold)).join("")
        : empty("まだいいねした提案はありません");
  };
  show("proposals");
  el.querySelector("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    el.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
    show(b.dataset.k);
  });

  el.querySelector("#menu")?.addEventListener("click", async () => {
    const v = await actionSheet([
      data.blocked ? { label: "ブロックを解除", value: "unblock" } : { label: "ブロックする", value: "block", danger: true },
      { label: "このユーザを通報", value: "report" },
    ]);
    if (v === "block") await block(u.id, u.display_name, () => renderProfile(el, id, { self }));
    else if (v === "unblock") {
      await api.del(`/blocks/${encodeURIComponent(u.id)}`).catch((err) => toast(err.message));
      await renderProfile(el, id, { self });
    } else if (v === "report") await report("user", u.id);
  });
}

export async function userHome(el) {
  if (!session.user) return loginView(el);
  await renderProfile(el, session.user.id, { self: true });
}

export async function userProfile(el, id) {
  await renderProfile(el, id, { self: false });
}

/** 画像を中央で正方形に切り抜き、128px の JPEG にする（D1 に保存できる大きさにする） */
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const size = 128;
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => reject(new Error("画像を読み込めませんでした"));
    img.src = url;
  });
}

export async function userEdit(el) {
  if (!session.user) return loginView(el);
  const u = session.user;
  let newAvatar; // undefined: 変更なし / null: 削除 / string: 新しい画像
  el.innerHTML = `
    <header class="page-header"><a class="back" href="#/user">‹ ユーザ</a></header>
    <h1>プロフィールを編集</h1>
    <form class="form" id="f">
      <div class="avatar-edit">
        <span id="preview">${avatar(u, 88)}</span>
        <div class="row-buttons">
          <label class="btn small">画像を選ぶ<input type="file" accept="image/*" id="file" hidden /></label>
          <button type="button" class="btn small" id="remove">画像を外す</button>
        </div>
      </div>
      <label>表示名<input name="displayName" maxlength="30" required value="${esc(u.display_name)}" /></label>
      <p class="hint">ユーザ名（@${esc(u.username)}）は変えられません。</p>
      <button class="btn primary block" type="submit">保存する</button>
    </form>`;
  const preview = el.querySelector("#preview");
  el.querySelector("#file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      newAvatar = await resizeImage(file);
      preview.innerHTML = `<img class="avatar" style="width:88px;height:88px" src="${newAvatar}" alt="" />`;
    } catch (err) {
      toast(err.message);
    }
  });
  el.querySelector("#remove").addEventListener("click", () => {
    newAvatar = null;
    preview.innerHTML = avatar({ ...u, avatar_updated_at: null }, 88);
  });
  const form = el.querySelector("#f");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(form.querySelector('button[type="submit"]'), async () => {
      try {
        const body = { displayName: new FormData(form).get("displayName") };
        if (newAvatar !== undefined) body.avatar = newAvatar;
        await api.patch("/me", body);
        await refreshSession();
        toast("保存しました");
        go("#/user");
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

export async function userSettings(el) {
  if (!session.user) return loginView(el);
  const [{ passkeys }, { users: blocked }, reports] = await Promise.all([
    api.get("/me/passkeys"),
    api.get("/me/blocks"),
    session.isAdmin ? api.get("/reports") : Promise.resolve(null),
  ]);

  el.innerHTML = `
    <header class="page-header"><a class="back" href="#/user">‹ ユーザ</a></header>
    <h1>設定</h1>

    <section class="panel">
      <h2>パスキー</h2>
      <p class="hint">別の端末やパスワード管理アプリでもログインしたいときは、パスキーを追加してください。</p>
      <div class="list">
        ${passkeys
          .map(
            (k) => `<div class="row" data-id="${esc(k.id)}">
          <div class="row-main">
            <b>${esc(k.name)}</b>
            <span class="muted small">${k.backed_up ? "同期あり" : "この端末のみ"}・最後に使用: ${k.last_used_at ? timeAgo(k.last_used_at) : "未使用"}</span>
          </div>
          <button class="icon-btn small passkey-menu" aria-label="メニュー">⋯</button>
        </div>`,
          )
          .join("")}
      </div>
      <button class="btn block" id="add-passkey">＋ パスキーを追加</button>
    </section>

    <section class="panel">
      <h2>ブロック中のユーザ</h2>
      ${
        blocked.length
          ? `<div class="list">${blocked
              .map(
                (b) => `<div class="row">${avatar(b, 32)}<div class="row-main"><b>${esc(b.display_name)}</b><span class="muted small">@${esc(b.username)}</span></div>
              <button class="btn small unblock" data-id="${esc(b.id)}">解除</button></div>`,
              )
              .join("")}</div>`
          : `<p class="muted small">いません</p>`
      }
    </section>

    ${
      reports
        ? `<section class="panel">
      <h2>通報（管理者）</h2>
      ${
        reports.reports.length
          ? `<div class="list">${reports.reports
              .map(
                (r) => `<div class="row">
              <div class="row-main">
                <b>${r.target_type === "proposal" ? "提案" : r.target_type === "comment" ? "コメント" : "ユーザ"}: ${esc(r.target_text ?? "（削除済み）")}</b>
                <span class="muted small">理由: ${esc(r.reason)}・@${esc(r.reporter_username ?? "退会")}・${timeAgo(r.created_at)}</span>
                ${r.proposal_id ? `<a class="small" href="#/discuss/${esc(r.proposal_id)}">対象の提案を開く</a>` : r.target_type === "user" ? `<a class="small" href="#/users/${encodeURIComponent(r.target_id)}">ユーザを開く</a>` : ""}
              </div>
              <button class="btn small resolve" data-id="${r.id}">対応済み</button>
            </div>`,
              )
              .join("")}</div>`
          : `<p class="muted small">未対応の通報はありません</p>`
      }
    </section>`
        : ""
    }

    <section class="panel">
      <button class="btn block" id="logout">ログアウト</button>
      <button class="btn block danger" id="delete">アカウントを削除</button>
      <p class="hint">アカウントを削除すると、パスキー・いいね・コメント・Issue になっていない提案が消えます。Issue になった提案は、投稿者を消したうえで残ります。</p>
    </section>`;

  el.querySelectorAll(".passkey-menu").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const id = btn.closest(".row").dataset.id;
      const v = await actionSheet([
        { label: "名前を変える", value: "rename" },
        { label: "削除", value: "delete", danger: true },
      ]);
      try {
        if (v === "rename") {
          const name = prompt("パスキーの名前", passkeys.find((k) => k.id === id)?.name ?? "");
          if (name === null) return;
          await api.patch(`/me/passkeys/${encodeURIComponent(id)}`, { name });
        } else if (v === "delete") {
          if (!confirm("このパスキーを削除しますか？\n端末側のパスキーは「設定」アプリの「パスワード」から削除してください。")) return;
          await api.del(`/me/passkeys/${encodeURIComponent(id)}`);
        } else return;
        await userSettings(el);
      } catch (err) {
        toast(err.message);
      }
    }),
  );

  el.querySelector("#add-passkey").addEventListener("click", (e) =>
    busy(e.currentTarget, async () => {
      try {
        const { flowId, options } = await api.post("/me/passkeys/options");
        const response = await createPasskey(options);
        await api.post("/me/passkeys/verify", { flowId, response });
        toast("パスキーを追加しました");
        await userSettings(el);
      } catch (err) {
        toast(err.status ? err.message : passkeyErrorMessage(err));
      }
    }),
  );

  el.querySelectorAll(".unblock").forEach((b) =>
    b.addEventListener("click", async () => {
      await api.del(`/blocks/${encodeURIComponent(b.dataset.id)}`).catch((err) => toast(err.message));
      await userSettings(el);
    }),
  );

  el.querySelectorAll(".resolve").forEach((b) =>
    b.addEventListener("click", async () => {
      await api.post(`/reports/${b.dataset.id}/resolve`).catch((err) => toast(err.message));
      await userSettings(el);
    }),
  );

  el.querySelector("#logout").addEventListener("click", async () => {
    await api.post("/auth/logout").catch(() => {});
    await refreshSession();
    toast("ログアウトしました");
    go("#/main");
  });

  el.querySelector("#delete").addEventListener("click", async () => {
    const typed = prompt(`アカウントを削除します。元に戻せません。\n確認のため、ユーザ名「${session.user.username}」を入力してください。`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== session.user.username.toLowerCase()) return toast("ユーザ名が一致しません");
    try {
      await api.del("/me");
      await refreshSession();
      alert("アカウントを削除しました。端末に残っているパスキーは「設定」アプリの「パスワード」から削除できます。");
      go("#/main");
    } catch (err) {
      toast(err.message);
    }
  });
}
