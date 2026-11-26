import { Hono, type Context } from "hono";
import type { AppEnv } from "./types";
import { maybeCreateIssue } from "./github";
import { checkProposal } from "./moderation";
import { notifyUser } from "./push";
import { fail, intParam, isAdmin, issueThreshold, now, readJson, requireUser, rpInfo, str } from "./util";

const DAY = 24 * 60 * 60 * 1000;
const MAX_PROPOSALS_PER_DAY = 10;
const MAX_COMMENTS_PER_DAY = 100;

/** ブロックしたユーザの投稿を除く条件（? には見ている人の ID を入れる） */
export const NOT_BLOCKED = (col: string) =>
  `(${col} IS NULL OR ${col} NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?))`;

export const viewerId = (c: Context<AppEnv>) => c.get("user")?.id ?? "";

export const PROPOSAL_COLUMNS = `
  p.id, p.title, p.status, p.issue_number, p.issue_url, p.created_at, p.issued_at, p.dev_status, p.dev_status_at,
  p.user_id, u.username, u.display_name, u.avatar_updated_at,
  (SELECT COUNT(*) FROM likes WHERE proposal_id = p.id) AS like_count,
  (SELECT COUNT(*) FROM comments WHERE proposal_id = p.id) AS comment_count`;

export const proposals = new Hono<AppEnv>();

proposals.get("/", async (c) => {
  const sort = c.req.query("sort") ?? "new";
  const viewer = viewerId(c);
  let where = NOT_BLOCKED("p.user_id");
  let order = "p.created_at DESC";
  if (sort === "popular") {
    where += " AND p.status != 'issued'";
    order = "like_count DESC, p.created_at DESC";
  } else if (sort === "issued") {
    where += " AND p.status = 'issued'";
    order = "p.issued_at DESC";
  }
  const { results } = await c.env.DB.prepare(
    `SELECT ${PROPOSAL_COLUMNS},
            EXISTS (SELECT 1 FROM likes WHERE proposal_id = p.id AND user_id = ?) AS liked
       FROM proposals p LEFT JOIN users u ON u.id = p.user_id
      WHERE ${where}
      ORDER BY ${order}
      LIMIT 100`,
  )
    .bind(viewer, viewer)
    .all();
  const t = await issueThreshold(c.env);
  return c.json({ proposals: results, threshold: t.threshold, thresholdInfo: t });
});

proposals.post("/", async (c) => {
  const user = requireUser(c);
  const body = await readJson(c);
  const title = str(body.title, "タイトル", { max: 100 });
  const text = str(body.body, "内容", { max: 4000 });
  // いいねが集まると Issue になり自動で開発されるので、リポジトリへの操作・攻撃・アプリの削除などは受け付けない
  const rejected = checkProposal(title, text);
  if (rejected) fail(400, rejected.message);
  const recent = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM proposals WHERE user_id = ? AND created_at > ?")
    .bind(user.id, now() - DAY)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_PROPOSALS_PER_DAY) fail(429, `提案は 1 日 ${MAX_PROPOSALS_PER_DAY} 件までです`);
  const row = await c.env.DB.prepare(
    "INSERT INTO proposals (user_id, title, body, created_at) VALUES (?, ?, ?, ?) RETURNING id",
  )
    .bind(user.id, title, text, now())
    .first<{ id: number }>();
  return c.json({ id: row!.id });
});

proposals.get("/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  const viewer = viewerId(c);
  const proposal = await c.env.DB.prepare(
    `SELECT ${PROPOSAL_COLUMNS}, p.body,
            EXISTS (SELECT 1 FROM likes WHERE proposal_id = p.id AND user_id = ?) AS liked
       FROM proposals p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ?`,
  )
    .bind(viewer, id)
    .first<Record<string, unknown>>();
  if (!proposal) fail(404, "提案が見つかりません");
  const { results: comments } = await c.env.DB.prepare(
    `SELECT cm.id, cm.body, cm.created_at, cm.user_id, u.username, u.display_name, u.avatar_updated_at
       FROM comments cm LEFT JOIN users u ON u.id = cm.user_id
      WHERE cm.proposal_id = ? AND ${NOT_BLOCKED("cm.user_id")}
      ORDER BY cm.created_at`,
  )
    .bind(id, viewer)
    .all();
  const blocked = viewer
    ? !!(await c.env.DB.prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?")
        .bind(viewer, proposal.user_id ?? "")
        .first())
    : false;
  const t = await issueThreshold(c.env);
  return c.json({ proposal, comments, blockedAuthor: blocked, threshold: t.threshold, thresholdInfo: t });
});

proposals.delete("/:id", async (c) => {
  const user = requireUser(c);
  const id = intParam(c.req.param("id"));
  const p = await c.env.DB.prepare("SELECT user_id, status FROM proposals WHERE id = ?")
    .bind(id)
    .first<{ user_id: string | null; status: string }>();
  if (!p) fail(404, "提案が見つかりません");
  if (!isAdmin(c.env, user)) {
    if (p.user_id !== user.id) fail(403, "自分の提案だけ削除できます");
    if (p.status !== "open") fail(400, "Issue になった提案は削除できません");
  }
  await c.env.DB.prepare("DELETE FROM proposals WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

async function likeState(c: Context<AppEnv>, id: number, userId: string) {
  const row = await c.env.DB.prepare(
    `SELECT status, issue_url, issue_number,
            (SELECT COUNT(*) FROM likes WHERE proposal_id = p.id) AS like_count,
            EXISTS (SELECT 1 FROM likes WHERE proposal_id = p.id AND user_id = ?) AS liked
       FROM proposals p WHERE id = ?`,
  )
    .bind(userId, id)
    .first();
  return c.json(row);
}

proposals.post("/:id/like", async (c) => {
  const user = requireUser(c);
  const id = intParam(c.req.param("id"));
  const exists = await c.env.DB.prepare("SELECT 1 FROM proposals WHERE id = ?").bind(id).first();
  if (!exists) fail(404, "提案が見つかりません");
  await c.env.DB.prepare("INSERT OR IGNORE INTO likes (proposal_id, user_id, created_at) VALUES (?, ?, ?)")
    .bind(id, user.id, now())
    .run();
  await maybeCreateIssue(c.env, id, rpInfo(c).origin);
  return likeState(c, id, user.id);
});

proposals.delete("/:id/like", async (c) => {
  const user = requireUser(c);
  const id = intParam(c.req.param("id"));
  await c.env.DB.prepare("DELETE FROM likes WHERE proposal_id = ? AND user_id = ?").bind(id, user.id).run();
  return likeState(c, id, user.id);
});

proposals.post("/:id/comments", async (c) => {
  const user = requireUser(c);
  const id = intParam(c.req.param("id"));
  const body = await readJson(c);
  const text = str(body.body, "コメント", { max: 2000 });
  const exists = await c.env.DB.prepare("SELECT 1 FROM proposals WHERE id = ?").bind(id).first();
  if (!exists) fail(404, "提案が見つかりません");
  const recent = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND created_at > ?")
    .bind(user.id, now() - DAY)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_COMMENTS_PER_DAY) fail(429, `コメントは 1 日 ${MAX_COMMENTS_PER_DAY} 件までです`);
  await c.env.DB.prepare("INSERT INTO comments (proposal_id, user_id, body, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, user.id, text, now())
    .run();
  // 提案者に知らせる（自分のコメントと、提案者がブロックしている人のコメントは知らせない）
  const p = await c.env.DB.prepare(
    `SELECT user_id, title FROM proposals
      WHERE id = ? AND user_id IS NOT NULL AND user_id != ?
        AND NOT EXISTS (SELECT 1 FROM blocks WHERE blocker_id = proposals.user_id AND blocked_id = ?)`,
  )
    .bind(id, user.id, user.id)
    .first<{ user_id: string; title: string }>();
  if (p) {
    c.executionCtx.waitUntil(
      notifyUser(c.env, p.user_id, {
        title: `${user.display_name}さんがコメントしました`,
        body: `「${p.title}」: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`,
        path: `#/discuss/${id}`,
      }),
    );
  }
  return c.json({ ok: true });
});

export const comments = new Hono<AppEnv>();

comments.delete("/:id", async (c) => {
  const user = requireUser(c);
  const id = intParam(c.req.param("id"));
  const res = isAdmin(c.env, user)
    ? await c.env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run()
    : await c.env.DB.prepare("DELETE FROM comments WHERE id = ? AND user_id = ?").bind(id, user.id).run();
  if (res.meta.changes === 0) fail(403, "自分のコメントだけ削除できます");
  return c.json({ ok: true });
});
