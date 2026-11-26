import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, Env, SessionUser } from "./types";

export const now = () => Date.now();

export function randomId(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return toBase64Url(buf);
}

export function toBase64Url(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toBase64Url(new Uint8Array(digest));
}

export function fail(status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502, message: string): never {
  throw new HTTPException(status, { message });
}

export function requireUser(c: Context<AppEnv>): SessionUser {
  const user = c.get("user");
  if (!user) fail(401, "ログインが必要です");
  return user;
}

/** 管理者のユーザ名（小文字） */
export function adminUsernames(env: Env): string[] {
  return (env.ADMIN_USERNAMES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(env: Env, user: SessionUser | null): boolean {
  if (!user) return false;
  return adminUsernames(env).includes(user.username.toLowerCase());
}

/** パスキーの RP ID と origin。PUBLIC_ORIGIN が無ければアクセスされたホストを使う */
export function rpInfo(c: Context<AppEnv>): { rpID: string; origin: string } {
  const origin = c.env.PUBLIC_ORIGIN || new URL(c.req.url).origin;
  return { rpID: new URL(origin).hostname, origin };
}

export interface ThresholdInfo {
  /** 今 Issue 化に必要ないいね数 */
  threshold: number;
  /** 設定上の基準（LIKE_THRESHOLD） */
  base: number;
  /** 登録ユーザ数 */
  users: number;
  /** ユーザが基準に満たないため、過半数で決めているか */
  majority: boolean;
}

/**
 * Issue 化に必要ないいね数。
 * ユーザ数が LIKE_THRESHOLD に満たないうちは、過半数（ユーザ数 / 2 を切り捨てて + 1）にする。
 */
export async function issueThreshold(env: Env): Promise<ThresholdInfo> {
  const base = likeThreshold(env);
  // 管理者はユーザ数に数えない
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE lower(username) NOT IN (SELECT value FROM json_each(?))",
  )
    .bind(JSON.stringify(adminUsernames(env)))
    .first<{ n: number }>();
  const users = row?.n ?? 0;
  if (users >= base) return { threshold: base, base, users, majority: false };
  return { threshold: Math.max(1, Math.floor(users / 2) + 1), base, users, majority: true };
}

export function likeThreshold(env: Env): number {
  const n = parseInt(env.LIKE_THRESHOLD, 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export async function readJson<T = Record<string, unknown>>(c: Context<AppEnv>): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    fail(400, "リクエストの形が正しくありません");
  }
}

export function str(v: unknown, field: string, { min = 1, max }: { min?: number; max: number }): string {
  if (typeof v !== "string") fail(400, `${field}を入力してください`);
  const s = v.trim();
  if (s.length < min) fail(400, min <= 1 ? `${field}を入力してください` : `${field}は${min}文字以上にしてください`);
  if (s.length > max) fail(400, `${field}は${max}文字以内にしてください`);
  return s;
}

export function intParam(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) fail(404, "見つかりません");
  return n;
}
