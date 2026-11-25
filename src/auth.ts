import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { AppEnv } from "./types";
import { createSession, destroySession } from "./session";
import { fail, fromBase64Url, now, randomId, readJson, requireUser, rpInfo, toBase64Url } from "./util";

const CHALLENGE_TTL = 5 * 60 * 1000;
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

interface ChallengeRow {
  id: string;
  kind: string;
  challenge: string;
  user_id: string | null;
  username: string | null;
  expires_at: number;
}

interface CredentialRow {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
}

async function saveChallenge(
  c: Context<AppEnv>,
  kind: string,
  challenge: string,
  userId: string | null,
  username: string | null,
) {
  const id = randomId(16);
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM challenges WHERE expires_at < ?").bind(t),
    c.env.DB.prepare(
      "INSERT INTO challenges (id, kind, challenge, user_id, username, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(id, kind, challenge, userId, username, t + CHALLENGE_TTL),
  ]);
  return id;
}

/** 1 回だけ使えるチャレンジを取り出す */
async function takeChallenge(c: Context<AppEnv>, id: unknown, kind: string): Promise<ChallengeRow> {
  if (typeof id !== "string") fail(400, "やり直してください");
  const row = await c.env.DB.prepare("DELETE FROM challenges WHERE id = ? AND kind = ? RETURNING *")
    .bind(id, kind)
    .first<ChallengeRow>();
  if (!row || row.expires_at < now()) fail(400, "時間切れです。もう一度やり直してください");
  return row;
}

function credentialName() {
  const d = new Date(now() + 9 * 60 * 60 * 1000); // 日本時間
  return `パスキー（${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()} 登録）`;
}

function insertCredential(
  c: Context<AppEnv>,
  userId: string,
  info: Extract<Awaited<ReturnType<typeof verifyRegistrationResponse>>, { verified: true }>["registrationInfo"],
) {
  return c.env.DB.prepare(
    `INSERT INTO credentials (id, user_id, public_key, counter, transports, device_type, backed_up, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    info.credential.id,
    userId,
    toBase64Url(info.credential.publicKey),
    info.credential.counter,
    JSON.stringify(info.credential.transports ?? []),
    info.credentialDeviceType,
    info.credentialBackedUp ? 1 : 0,
    credentialName(),
    now(),
  );
}

async function verifyRegistration(c: Context<AppEnv>, response: unknown, challenge: string) {
  const { rpID, origin } = rpInfo(c);
  try {
    const result = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
    if (!result.verified) fail(400, "パスキーを確認できませんでした");
    return result.registrationInfo;
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    console.error("registration verify failed", e);
    fail(400, "パスキーを確認できませんでした");
  }
}

export const auth = new Hono<AppEnv>();

/** 新規登録: ユーザ名を受け取り、パスキー作成のオプションを返す */
auth.post("/register/options", async (c) => {
  const body = await readJson(c);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!USERNAME_RE.test(username)) fail(400, "ユーザ名は半角英数字と _ で 3〜20 文字にしてください");
  const taken = await c.env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first();
  if (taken) fail(409, "このユーザ名はすでに使われています");

  const userIdBytes = crypto.getRandomValues(new Uint8Array(16));
  const { rpID } = rpInfo(c);
  const options = await generateRegistrationOptions({
    rpName: c.env.RP_NAME,
    rpID,
    userName: username,
    userDisplayName: username,
    userID: userIdBytes,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  const flowId = await saveChallenge(c, "register", options.challenge, toBase64Url(userIdBytes), username);
  return c.json({ flowId, options });
});

auth.post("/register/verify", async (c) => {
  const body = await readJson(c);
  const ch = await takeChallenge(c, body.flowId, "register");
  const info = await verifyRegistration(c, body.response, ch.challenge);
  const userId = ch.user_id!;
  const username = ch.username!;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO users (id, username, display_name, created_at) VALUES (?, ?, ?, ?)").bind(
        userId,
        username,
        username,
        now(),
      ),
      insertCredential(c, userId, info),
    ]);
  } catch (e) {
    console.error("register insert failed", e);
    fail(409, "このユーザ名はすでに使われています");
  }
  await createSession(c, userId);
  return c.json({ ok: true });
});

/** ログイン: 端末に保存されたパスキーから選んでもらう（ユーザ名の入力は不要） */
auth.post("/login/options", async (c) => {
  const { rpID } = rpInfo(c);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  const flowId = await saveChallenge(c, "login", options.challenge, null, null);
  return c.json({ flowId, options });
});

auth.post("/login/verify", async (c) => {
  const body = await readJson(c);
  const ch = await takeChallenge(c, body.flowId, "login");
  const response = body.response as AuthenticationResponseJSON | undefined;
  if (!response || typeof response.id !== "string") fail(400, "やり直してください");
  const cred = await c.env.DB.prepare("SELECT * FROM credentials WHERE id = ?").bind(response.id).first<CredentialRow>();
  if (!cred) fail(400, "このパスキーは登録されていません。アカウントが削除されたか、パスキーが削除された可能性があります");

  const { rpID, origin } = rpInfo(c);
  let newCounter: number;
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ch.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: cred.id,
        publicKey: fromBase64Url(cred.public_key),
        counter: cred.counter,
        transports: cred.transports ? JSON.parse(cred.transports) : undefined,
      },
    });
    if (!result.verified) fail(400, "パスキーを確認できませんでした");
    newCounter = result.authenticationInfo.newCounter;
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    console.error("authentication verify failed", e);
    fail(400, "パスキーを確認できませんでした");
  }
  await c.env.DB.prepare("UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?")
    .bind(newCounter, now(), cred.id)
    .run();
  await createSession(c, cred.user_id);
  return c.json({ ok: true });
});

auth.post("/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

/** ログイン中のユーザにパスキーを追加する */
export const passkeys = new Hono<AppEnv>();

passkeys.get("/", async (c) => {
  const user = requireUser(c);
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, device_type, backed_up, created_at, last_used_at FROM credentials WHERE user_id = ? ORDER BY created_at",
  )
    .bind(user.id)
    .all();
  return c.json({ passkeys: results });
});

passkeys.post("/options", async (c) => {
  const user = requireUser(c);
  const { results } = await c.env.DB.prepare("SELECT id, transports FROM credentials WHERE user_id = ?")
    .bind(user.id)
    .all<{ id: string; transports: string | null }>();
  const { rpID } = rpInfo(c);
  const options = await generateRegistrationOptions({
    rpName: c.env.RP_NAME,
    rpID,
    userName: user.username,
    userDisplayName: user.display_name,
    userID: fromBase64Url(user.id),
    attestationType: "none",
    excludeCredentials: results.map((r) => ({ id: r.id, transports: r.transports ? JSON.parse(r.transports) : [] })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  const flowId = await saveChallenge(c, "add", options.challenge, user.id, null);
  return c.json({ flowId, options });
});

passkeys.post("/verify", async (c) => {
  const user = requireUser(c);
  const body = await readJson(c);
  const ch = await takeChallenge(c, body.flowId, "add");
  if (ch.user_id !== user.id) fail(400, "やり直してください");
  const info = await verifyRegistration(c, body.response, ch.challenge);
  try {
    await insertCredential(c, user.id, info).run();
  } catch {
    fail(409, "このパスキーはすでに登録されています");
  }
  return c.json({ ok: true });
});

passkeys.patch("/:id", async (c) => {
  const user = requireUser(c);
  const body = await readJson(c);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 40) fail(400, "名前は 1〜40 文字にしてください");
  await c.env.DB.prepare("UPDATE credentials SET name = ? WHERE id = ? AND user_id = ?")
    .bind(name, c.req.param("id"), user.id)
    .run();
  return c.json({ ok: true });
});

passkeys.delete("/:id", async (c) => {
  const user = requireUser(c);
  // 最後の 1 つは消せない（消すとログインできなくなる）
  const res = await c.env.DB.prepare(
    `DELETE FROM credentials WHERE id = ? AND user_id = ?
       AND (SELECT COUNT(*) FROM credentials WHERE user_id = ?) > 1`,
  )
    .bind(c.req.param("id"), user.id, user.id)
    .run();
  if (res.meta.changes === 0) fail(400, "最後のパスキーは削除できません");
  return c.json({ ok: true });
});
