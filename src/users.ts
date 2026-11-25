import { Hono } from "hono";
import type { AppEnv } from "./types";
import { destroySession } from "./session";
import { PROPOSAL_COLUMNS, viewerId } from "./proposals";
import { fail, isAdmin, likeThreshold, now, readJson, requireUser, str } from "./util";

const DAY = 24 * 60 * 60 * 1000;
const JST = 9 * 60 * 60 * 1000;
const ACTIVITY_DAYS = 7 * 13; // 12 週＋今週の途中まで表示できる長さ
const MAX_AVATAR_CHARS = 80_000;

/** 貢献スコア: 提案 3 点、Issue 化 10 点、コメント 1 点、もらったいいね 1 点 */
const STATS_SQL = `
  SELECT *, proposal_count * 3 + issued_count * 10 + comment_count + likes_received AS score FROM (
    SELECT u.id, u.username, u.display_name, u.avatar_updated_at, u.created_at,
      (SELECT COUNT(*) FROM proposals WHERE user_id = u.id) AS proposal_count,
      (SELECT COUNT(*) FROM proposals WHERE user_id = u.id AND status = 'issued') AS issued_count,
      (SELECT COUNT(*) FROM comments WHERE user_id = u.id) AS comment_count,
      (SELECT COUNT(*) FROM likes l JOIN proposals p ON p.id = l.proposal_id
        WHERE p.user_id = u.id AND l.user_id != u.id) AS likes_received
    FROM users u %WHERE%
  )`;

export const users = new Hono<AppEnv>();

/** 貢献者ランキング */
users.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `${STATS_SQL.replace("%WHERE%", "")} WHERE score > 0 ORDER BY score DESC, created_at LIMIT 50`,
  ).all();
  return c.json({ users: results });
});

users.get("/:id", async (c) => {
  const id = c.req.param("id");
  const viewer = viewerId(c);
  const user = await c.env.DB.prepare(STATS_SQL.replace("%WHERE%", "WHERE u.id = ?")).bind(id).first();
  if (!user) fail(404, "ユーザが見つかりません");

  const since = now() - ACTIVITY_DAYS * DAY;
  const [proposals, comments, activity, blocked] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT ${PROPOSAL_COLUMNS} FROM proposals p LEFT JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 100`,
    ).bind(id),
    c.env.DB.prepare(
      `SELECT cm.id, cm.body, cm.created_at, p.id AS proposal_id, p.title AS proposal_title, p.status AS proposal_status
         FROM comments cm JOIN proposals p ON p.id = cm.proposal_id
        WHERE cm.user_id = ? ORDER BY cm.created_at DESC LIMIT 100`,
    ).bind(id),
    c.env.DB.prepare(
      `SELECT created_at FROM proposals WHERE user_id = ? AND created_at > ?
       UNION ALL SELECT created_at FROM comments WHERE user_id = ? AND created_at > ?`,
    ).bind(id, since, id, since),
    c.env.DB.prepare("SELECT 1 AS b FROM blocks WHERE blocker_id = ? AND blocked_id = ?").bind(viewer, id),
  ]);

  // 日本時間の日付ごとの件数（GitHub の草のように表示する）
  const days: Record<string, number> = {};
  for (const r of activity.results as { created_at: number }[]) {
    const key = new Date(r.created_at + JST).toISOString().slice(0, 10);
    days[key] = (days[key] ?? 0) + 1;
  }

  return c.json({
    user,
    proposals: proposals.results,
    comments: comments.results,
    activity: days,
    activityDays: ACTIVITY_DAYS,
    blocked: blocked.results.length > 0,
    isMe: viewer === id,
  });
});

users.get("/:id/avatar", async (c) => {
  const row = await c.env.DB.prepare("SELECT avatar FROM users WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ avatar: string | null }>();
  const m = row?.avatar?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return c.notFound();
  const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
  return c.body(bytes, 200, {
    "Content-Type": m[1],
    "Cache-Control": "public, max-age=31536000, immutable",
  });
});

/** ログイン中のユーザ自身 */
export const me = new Hono<AppEnv>();

me.get("/", (c) => {
  const user = c.get("user");
  return c.json({ user, isAdmin: isAdmin(c.env, user), threshold: likeThreshold(c.env) });
});

me.patch("/", async (c) => {
  const user = requireUser(c);
  const body = await readJson(c);
  if (body.displayName !== undefined) {
    const name = str(body.displayName, "表示名", { max: 30 });
    await c.env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(name, user.id).run();
  }
  if (body.avatar !== undefined) {
    const avatar = body.avatar;
    if (avatar !== null) {
      if (typeof avatar !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar))
        fail(400, "画像の形式が正しくありません");
      if (avatar.length > MAX_AVATAR_CHARS) fail(400, "画像が大きすぎます");
    }
    await c.env.DB.prepare("UPDATE users SET avatar = ?, avatar_updated_at = ? WHERE id = ?")
      .bind(avatar, avatar === null ? null : now(), user.id)
      .run();
  }
  return c.json({ ok: true });
});

/** アカウント削除（App Store の審査で必須） */
me.delete("/", async (c) => {
  const user = requireUser(c);
  await c.env.DB.batch([
    // Issue になった提案は GitHub と対応しているので、本文を残して提案者だけ消す
    c.env.DB.prepare("UPDATE proposals SET user_id = NULL WHERE user_id = ? AND status != 'open'").bind(user.id),
    c.env.DB.prepare("DELETE FROM proposals WHERE user_id = ?").bind(user.id),
    // パスキー・セッション・いいね・コメント・ブロックは外部キーで一緒に消える
    c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  await destroySession(c);
  return c.json({ ok: true });
});

me.get("/likes", async (c) => {
  const user = requireUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT ${PROPOSAL_COLUMNS}, l.created_at AS liked_at
       FROM likes l JOIN proposals p ON p.id = l.proposal_id LEFT JOIN users u ON u.id = p.user_id
      WHERE l.user_id = ? ORDER BY l.created_at DESC LIMIT 100`,
  )
    .bind(user.id)
    .all();
  return c.json({ proposals: results });
});

me.get("/blocks", async (c) => {
  const user = requireUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.avatar_updated_at
       FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC`,
  )
    .bind(user.id)
    .all();
  return c.json({ users: results });
});

/** ブロック */
export const blocks = new Hono<AppEnv>();

blocks.post("/:userId", async (c) => {
  const user = requireUser(c);
  const target = c.req.param("userId");
  if (target === user.id) fail(400, "自分はブロックできません");
  const exists = await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(target).first();
  if (!exists) fail(404, "ユーザが見つかりません");
  await c.env.DB.prepare("INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)")
    .bind(user.id, target, now())
    .run();
  return c.json({ ok: true });
});

blocks.delete("/:userId", async (c) => {
  const user = requireUser(c);
  await c.env.DB.prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?")
    .bind(user.id, c.req.param("userId"))
    .run();
  return c.json({ ok: true });
});

/** 通報 */
export const reports = new Hono<AppEnv>();

reports.post("/", async (c) => {
  const user = requireUser(c);
  const body = await readJson(c);
  const type = body.targetType;
  if (type !== "proposal" && type !== "comment" && type !== "user") fail(400, "通報の対象が正しくありません");
  const targetId = str(String(body.targetId ?? ""), "通報の対象", { max: 64 });
  const reason = str(body.reason, "通報の理由", { max: 500 });
  await c.env.DB.prepare(
    "INSERT INTO reports (reporter_id, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(user.id, type, targetId, reason, now())
    .run();
  return c.json({ ok: true });
});

reports.get("/", async (c) => {
  const user = requireUser(c);
  if (!isAdmin(c.env, user)) fail(403, "管理者だけが見られます");
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, u.username AS reporter_username,
            CASE r.target_type
              WHEN 'proposal' THEN (SELECT title FROM proposals WHERE id = r.target_id)
              WHEN 'comment' THEN (SELECT body FROM comments WHERE id = r.target_id)
              WHEN 'user' THEN (SELECT username FROM users WHERE id = r.target_id)
            END AS target_text,
            CASE r.target_type
              WHEN 'comment' THEN (SELECT proposal_id FROM comments WHERE id = r.target_id)
              WHEN 'proposal' THEN r.target_id
            END AS proposal_id
       FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
      WHERE r.resolved = 0 ORDER BY r.created_at DESC LIMIT 100`,
  ).all();
  return c.json({ reports: results });
});

reports.post("/:id/resolve", async (c) => {
  const user = requireUser(c);
  if (!isAdmin(c.env, user)) fail(403, "管理者だけが操作できます");
  await c.env.DB.prepare("UPDATE reports SET resolved = 1 WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

