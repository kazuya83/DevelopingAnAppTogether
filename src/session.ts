import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, SessionUser } from "./types";
import { now, randomId, sha256 } from "./util";

const COOKIE = "sid";
const SESSION_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;

function secure(c: Context<AppEnv>) {
  return new URL(c.req.url).protocol === "https:";
}

export async function createSession(c: Context<AppEnv>, userId: string) {
  const token = randomId(32);
  const t = now();
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, t, t + SESSION_DAYS * DAY)
    .run();
  setSessionCookie(c, token);
}

function setSessionCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: secure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession(c: Context<AppEnv>) {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
  deleteCookie(c, COOKIE, { path: "/", secure: secure(c) });
}

/** Cookie からログイン中のユーザを読み込む */
export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", null);
  const token = getCookie(c, COOKIE);
  if (token) {
    const row = await c.env.DB.prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_updated_at, u.created_at, s.expires_at, s.id AS sid
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`,
    )
      .bind(await sha256(token))
      .first<SessionUser & { expires_at: number; sid: string }>();
    if (row && row.expires_at > now()) {
      const { expires_at, sid, ...user } = row;
      c.set("user", user);
      // 残りが半分を切ったら延長する
      if (expires_at - now() < (SESSION_DAYS / 2) * DAY) {
        await c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
          .bind(now() + SESSION_DAYS * DAY, sid)
          .run();
        setSessionCookie(c, token);
      }
    }
  }
  await next();
};
