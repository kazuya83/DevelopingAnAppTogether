import { api } from "../api.js";
import { go, requireLogin, session } from "../app.js";
import {
  actionSheet,
  authorLink,
  avatar,
  busy,
  empty,
  esc,
  linkify,
  proposalCard,
  statusBadge,
  thresholdNote,
  timeAgo,
  toast,
} from "../ui.js";

const SORTS = [
  ["new", "新着"],
  ["popular", "投票中"],
  ["issued", "Issue 化済み"],
];

let currentSort = "new";

export async function discussList(el) {
  const data = await api.get(`/proposals?sort=${currentSort}`);
  el.innerHTML = `
    <header class="page-header">
      <h1>議論</h1>
      <a class="btn small primary" href="#/discuss/new">＋ 提案する</a>
    </header>
    <p class="lead">アプリに入れたい機能や直してほしいところを提案しよう。いいねが <b>${data.threshold}</b> 件集まると GitHub の Issue になり、開発が始まります。${thresholdNote(data.thresholdInfo) ? `<br />${thresholdNote(data.thresholdInfo)}` : ""}</p>
    <div class="segmented">
      ${SORTS.map(([k, label]) => `<button data-sort="${k}" class="${k === currentSort ? "active" : ""}">${label}</button>`).join("")}
    </div>
    <a class="ranking-link" href="#/contributors">🏆 貢献者ランキングを見る</a>
    <div class="list">
      ${data.proposals.length ? data.proposals.map((p) => proposalCard(p, data.threshold)).join("") : empty("まだ提案がありません。最初の提案をしてみよう！")}
    </div>`;
  el.querySelector(".segmented").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    currentSort = b.dataset.sort;
    go("#/discuss");
  });
  el.querySelector('a[href="#/discuss/new"]').addEventListener("click", (e) => {
    if (!session.user) {
      e.preventDefault();
      sessionStorage.setItem("returnTo", "#/discuss/new");
      go("#/login");
    }
  });
}

export async function discussNew(el) {
  if (!requireLogin()) return;
  el.innerHTML = `
    <header class="page-header"><a class="back" href="#/discuss">‹ 議論</a></header>
    <h1>提案する</h1>
    <form class="form" id="f">
      <label>タイトル<input name="title" maxlength="100" required placeholder="例: ダークモードに対応してほしい" /></label>
      <label>内容<textarea name="body" maxlength="4000" rows="10" required placeholder="何を作りたいか・直したいか、なぜ必要か、どうなれば完成かを書くと、開発が進みやすくなります"></textarea></label>
      <p class="hint">いいねが ${session.threshold} 件集まると、この内容がそのまま GitHub の公開 Issue になります。個人情報は書かないでください。</p>
      <p class="hint">次の提案は受け付けていません：GitHub のリポジトリ・設定・ルールファイルを変えるもの、AI への指示の上書きや攻撃につながるもの、このアプリやデータを消す・止めるもの。</p>
      <button class="btn primary block" type="submit">投稿する</button>
    </form>`;
  const form = el.querySelector("#f");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(form.querySelector("button"), async () => {
      try {
        const fd = new FormData(form);
        const { id } = await api.post("/proposals", { title: fd.get("title"), body: fd.get("body") });
        location.replace(`#/discuss/${id}`);
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

function likeBox(p, threshold) {
  if (p.status === "issued") {
    return `<div class="issue-box done">
      <div>🎉 いいねが集まり <b>GitHub Issue #${esc(p.issue_number)}</b> になりました</div>
      <a class="btn small" href="${esc(p.issue_url)}" target="_blank" rel="noopener">Issue を見る</a>
    </div>`;
  }
  const pct = Math.min(100, Math.round((p.like_count / threshold) * 100));
  const left = Math.max(0, threshold - p.like_count);
  const text =
    p.status === "creating"
      ? "Issue を作っています…"
      : left > 0
        ? `あと <b>${left}</b> いいねで GitHub Issue になります`
        : "Issue を作る準備中です（しばらくすると作られます）";
  return `<div class="issue-box">
      <div class="progress"><span style="width:${pct}%"></span></div>
      <div class="muted small">${text}（${p.like_count}/${threshold}）</div>
    </div>`;
}

export async function discussDetail(el, id) {
  const data = await api.get(`/proposals/${id}`);
  const p = data.proposal;
  const me = session.user;
  const mine = me && p.user_id === me.id;

  el.innerHTML = `
    <header class="page-header">
      <a class="back" href="#/discuss">‹ 議論</a>
      ${me ? `<button class="icon-btn" id="menu" aria-label="メニュー">⋯</button>` : ""}
    </header>
    <article class="proposal-detail">
      <h1>${esc(p.title)} ${statusBadge(p)}</h1>
      <div class="meta">${authorLink(p)}<span class="muted">・${timeAgo(p.created_at)}</span></div>
      ${data.blockedAuthor ? `<div class="empty">ブロックしているユーザの提案です</div>` : `<div class="body">${linkify(esc(p.body))}</div>`}
      <div id="like-area"></div>
    </article>
    <section class="comments">
      <h2>コメント <span class="muted">${data.comments.length}</span></h2>
      <div class="list">
        ${
          data.comments.length
            ? data.comments
                .map(
                  (cm) => `<div class="comment" data-id="${cm.id}" data-user="${esc(cm.user_id ?? "")}">
              ${cm.user_id ? `<a href="#/users/${encodeURIComponent(cm.user_id)}">${avatar(cm, 32)}</a>` : avatar(null, 32)}
              <div class="comment-main">
                <div class="comment-head">
                  ${cm.user_id ? `<a href="#/users/${encodeURIComponent(cm.user_id)}"><b>${esc(cm.display_name)}</b></a>` : "<b>退会したユーザ</b>"}
                  <span class="muted small">${timeAgo(cm.created_at)}</span>
                  <span class="spacer"></span>
                  ${me ? `<button class="icon-btn small comment-menu" aria-label="メニュー">⋯</button>` : ""}
                </div>
                <div class="body">${linkify(esc(cm.body))}</div>
              </div>
            </div>`,
                )
                .join("")
            : `<div class="empty small">まだコメントはありません</div>`
        }
      </div>
      ${
        me
          ? `<form class="comment-form" id="cf">
              <textarea name="body" rows="3" maxlength="2000" required placeholder="コメントを書く"></textarea>
              <button class="btn primary" type="submit">送信</button>
            </form>`
          : `<button class="btn block" id="login-to-comment">ログインしていいね・コメントする</button>`
      }
    </section>`;

  const likeArea = el.querySelector("#like-area");
  const renderLike = () => {
    likeArea.innerHTML = `
      <button class="like-btn ${p.liked ? "liked" : ""}" id="like">
        <span class="heart">${p.liked ? "♥" : "♡"}</span> いいね <b>${p.like_count}</b>
      </button>
      ${likeBox(p, data.threshold)}
      ${thresholdNote(data.thresholdInfo) ? `<div class="hint">${thresholdNote(data.thresholdInfo)}</div>` : ""}`;
    likeArea.querySelector("#like").addEventListener("click", (e) => {
      if (!requireLogin()) return;
      busy(e.currentTarget, async () => {
        try {
          const r = p.liked ? await api.del(`/proposals/${id}/like`) : await api.post(`/proposals/${id}/like`);
          Object.assign(p, r, { liked: !!r.liked });
          renderLike();
          // いいねしたときはハートを弾ませる
          if (p.liked) likeArea.querySelector(".heart")?.classList.add("pop");
          if (r.status === "issued" && p.issue_url) toast("いいねが集まり、GitHub Issue になりました！");
        } catch (err) {
          toast(err.message);
        }
      });
    });
  };
  p.liked = !!p.liked;
  renderLike();

  el.querySelector("#login-to-comment")?.addEventListener("click", () => requireLogin());

  const cf = el.querySelector("#cf");
  cf?.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(cf.querySelector("button"), async () => {
      try {
        await api.post(`/proposals/${id}/comments`, { body: new FormData(cf).get("body") });
        await discussDetail(el, id);
        el.querySelector(".comments .list")?.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (err) {
        toast(err.message);
      }
    });
  });

  el.querySelector("#menu")?.addEventListener("click", async () => {
    const items = [];
    if (mine || session.isAdmin)
      if (p.status === "open" || session.isAdmin) items.push({ label: "提案を削除", value: "delete", danger: true });
    if (!mine) {
      items.push({ label: "提案を通報", value: "report" });
      if (p.user_id) items.push({ label: "投稿者をブロック", value: "block", danger: true });
    }
    const v = await actionSheet(items);
    if (v === "delete" && confirm("この提案を削除しますか？")) {
      await api.del(`/proposals/${id}`).then(() => go("#/discuss"), (err) => toast(err.message));
    } else if (v === "report") {
      await report("proposal", id);
    } else if (v === "block") {
      await block(p.user_id, p.display_name, () => go("#/discuss"));
    }
  });

  el.querySelectorAll(".comment-menu").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const row = btn.closest(".comment");
      const cid = row.dataset.id;
      const uid = row.dataset.user;
      const mineComment = uid && uid === me.id;
      const items = [];
      if (mineComment || session.isAdmin) items.push({ label: "コメントを削除", value: "delete", danger: true });
      if (!mineComment) {
        items.push({ label: "コメントを通報", value: "report" });
        if (uid) items.push({ label: "このユーザをブロック", value: "block", danger: true });
      }
      const v = await actionSheet(items);
      if (v === "delete" && confirm("このコメントを削除しますか？")) {
        await api.del(`/comments/${cid}`).then(() => discussDetail(el, id), (err) => toast(err.message));
      } else if (v === "report") {
        await report("comment", cid);
      } else if (v === "block") {
        await block(uid, row.querySelector("b")?.textContent, () => discussDetail(el, id));
      }
    }),
  );
}

export async function report(targetType, targetId) {
  const reason = prompt("通報の理由を教えてください（例: 迷惑行為、不適切な内容）");
  if (reason === null) return;
  if (!reason.trim()) return toast("理由を入力してください");
  try {
    await api.post("/reports", { targetType, targetId: String(targetId), reason });
    toast("通報しました。管理者が確認します");
  } catch (err) {
    toast(err.message);
  }
}

export async function block(userId, name, after) {
  if (!confirm(`${name ?? "このユーザ"} さんをブロックしますか？\nこの人の提案とコメントが表示されなくなります。`)) return;
  try {
    await api.post(`/blocks/${encodeURIComponent(userId)}`);
    toast("ブロックしました");
    after?.();
  } catch (err) {
    toast(err.message);
  }
}

export async function contributors(el) {
  const { users } = await api.get("/users");
  el.innerHTML = `
    <header class="page-header"><a class="back" href="#/discuss">‹ 議論</a></header>
    <h1>貢献者ランキング</h1>
    <p class="lead small">提案 3 点・Issue 化 10 点・コメント 1 点・もらったいいね 1 点で計算しています。</p>
    <div class="list">
      ${
        users.length
          ? users
              .map(
                (u, i) => `<a class="card rank" href="#/users/${encodeURIComponent(u.id)}">
            <span class="rank-no rank-${i + 1}">${i + 1}</span>
            ${avatar(u, 40)}
            <span class="rank-main">
              <b>${esc(u.display_name)}</b><span class="muted small">@${esc(u.username)}</span>
              <span class="muted small">提案 ${u.proposal_count}・Issue化 ${u.issued_count}・コメント ${u.comment_count}・いいね ${u.likes_received}</span>
            </span>
            <span class="score">${u.score}<small>pt</small></span>
          </a>`,
              )
              .join("")
          : empty("まだ貢献したユーザがいません")
      }
    </div>`;
}
