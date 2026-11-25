export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 本文中の URL をリンクにする（エスケープ済みの文字列に対して使う） */
export const linkify = (escaped) =>
  escaped.replace(/https?:\/\/[^\s<>"']+/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);

const COLORS = ["#5b8def", "#e8743b", "#19a979", "#d6508c", "#945ecf", "#13a4b4", "#c19a1d", "#6c7a89"];

/** アイコン。画像が無ければ表示名の 1 文字目を色付きの丸に出す */
export function avatar(u, size = 36) {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px`;
  if (!u || !u.user_id && !u.id) return `<span class="avatar avatar-none" style="${style}">？</span>`;
  const id = u.user_id ?? u.id;
  if (u.avatar_updated_at)
    return `<img class="avatar" style="${style}" src="/api/users/${encodeURIComponent(id)}/avatar?v=${u.avatar_updated_at}" alt="" loading="lazy" />`;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const initial = [...(u.display_name || u.username || "?")][0];
  return `<span class="avatar" style="${style};background:${COLORS[h % COLORS.length]}">${esc(initial)}</span>`;
}

/** 投稿者の表示（退会したユーザにも対応） */
export function authorLink(u) {
  if (!u.user_id) return `<span class="author">${avatar(null, 24)}<span class="muted">退会したユーザ</span></span>`;
  return `<a class="author" href="#/users/${encodeURIComponent(u.user_id)}">${avatar(u, 24)}<span>${esc(u.display_name)}</span></a>`;
}

export function timeAgo(ms) {
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}日前`;
  return formatDate(ms);
}

export const formatDate = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

let toastTimer;
export function toast(message) {
  if (!message) return;
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

/** ボタンを押している間は二重送信できないようにする */
export async function busy(button, fn) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    return await fn();
  } finally {
    button.disabled = false;
  }
}

/** 下から出るメニュー。選ばれた項目の value を返す（閉じたら null） */
export function actionSheet(items) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "sheet-backdrop";
    wrap.innerHTML = `<div class="sheet" role="dialog">
      ${items.map((it, i) => `<button data-i="${i}" class="${it.danger ? "danger" : ""}">${esc(it.label)}</button>`).join("")}
      <button data-cancel class="cancel">キャンセル</button></div>`;
    const close = (v) => {
      wrap.remove();
      resolve(v);
    };
    wrap.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (e.target === wrap || b?.dataset.cancel !== undefined) return close(null);
      if (b) close(items[Number(b.dataset.i)].value);
    });
    document.body.append(wrap);
  });
}

export const statusBadge = (p) =>
  p.status === "issued"
    ? `<span class="badge issued">Issue #${esc(p.issue_number)}</span>`
    : p.status === "creating"
      ? `<span class="badge creating">Issue 作成中</span>`
      : "";

export function proposalCard(p, threshold) {
  return `<a class="card proposal" href="#/discuss/${p.id}">
    <div class="card-title">${esc(p.title)} ${statusBadge(p)}</div>
    <div class="card-meta">
      <span class="meta-author">${p.user_id ? avatar(p, 20) + esc(p.display_name) : "退会したユーザ"}</span>
      <span>・${timeAgo(p.created_at)}</span>
      <span class="spacer"></span>
      <span class="stat ${p.liked ? "liked" : ""}">♥ ${p.like_count}${p.status === "issued" ? "" : `/${threshold}`}</span>
      <span class="stat">💬 ${p.comment_count}</span>
    </div>
  </a>`;
}

export const loading = () => `<div class="loading"><span class="spinner"></span></div>`;
export const empty = (text) => `<div class="empty">${esc(text)}</div>`;

/** Issue 化の基準の説明（ユーザが少ないうちは過半数） */
export function thresholdNote(info) {
  if (!info?.majority) return "";
  return `今はユーザが ${info.users} 人なので、過半数の ${info.threshold} 件で Issue になります（${info.base} 人以上になると ${info.base} 件）。`;
}
