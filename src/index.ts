import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, Env } from "./types";
import { loadUser } from "./session";
import { auth, passkeys } from "./auth";
import { comments, proposals } from "./proposals";
import { blocks, me, reports, users } from "./users";
import { retryPendingIssues, syncDevStatuses } from "./github";
import { rpInfo } from "./util";

const app = new Hono<AppEnv>();

/** パスキーを iOS アプリ（WKWebView）の中で使うための設定ファイル */
app.get("/.well-known/apple-app-site-association", (c) =>
  c.json({ webcredentials: { apps: c.env.APPLE_APP_ID ? [c.env.APPLE_APP_ID] : [] } }),
);

const api = new Hono<AppEnv>();

// 別のサイトからの書き込みを防ぐ（Cookie は SameSite=Lax だが念のため Origin も確かめる）
api.use("*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("Origin");
    const allowed = [new URL(c.req.url).origin, rpInfo(c).origin];
    if (origin && !allowed.includes(origin)) throw new HTTPException(403, { message: "許可されていない送信元です" });
  }
  await next();
});
api.use("*", loadUser);
api.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

api.route("/auth", auth);
api.route("/me/passkeys", passkeys);
api.route("/me", me);
api.route("/proposals", proposals);
api.route("/comments", comments);
api.route("/users", users);
api.route("/blocks", blocks);
api.route("/reports", reports);

api.notFound((c) => c.json({ error: "見つかりません" }, 404));
api.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "サーバーでエラーが起きました。時間をおいてもう一度お試しください" }, 500);
});

app.route("/api", api);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      Promise.all([
        retryPendingIssues(env),
        syncDevStatuses(env),
        env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()).run(),
      ]),
    );
  },
} satisfies ExportedHandler<Env>;
