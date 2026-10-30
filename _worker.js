/**
 * Cloudflare Pages Functions 入口（根级 _worker.js = 全请求网关）
 *
 * 职责：
 *  1. 站点级主密码门禁（环境变量 SITE_PASSWORD）：未通过则任何页面都返回 gate.html
 *  2. 站内账户体系：站点密码通过后，首个注册者自动成为管理员；用户可设/不设密码
 *  3. 每用户数据持久化（D1）：读写按 user_id 隔离，跨设备一致；仅管理员可删用户
 *  4. 通过校验后，用 env.ASSETS.fetch 提供原始静态资源（知识图谱站点的页面）
 *
 * 会话：HttpOnly 签名 Cookie（HMAC-SHA256），无状态，无需额外 KV。
 */

const SITE_COOKIE = "site_session";
const USER_COOKIE = "user_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 天

// ---------- 基础工具 ----------
function b64url(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmac(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}
async function signToken(data, secret) {
  return `${data}.${await hmac(secret, data)}`;
}
async function verifyToken(token, secret) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const idx = token.lastIndexOf(".");
  const data = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = await hmac(secret, data);
  if (!constantTimeEqual(sig, expected)) return null;
  return data;
}
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function getCookie(req, name) {
  const c = req.headers.get("Cookie");
  if (!c) return null;
  for (const p of c.split(";")) {
    const i = p.indexOf("=");
    const k = p.slice(0, i).trim();
    if (k === name) return decodeURIComponent(p.slice(i + 1).trim());
  }
  return null;
}
function cookieStr(name, value, opts = {}) {
  let s = `${name}=${encodeURIComponent(value)}`;
  if (opts.maxAge != null) s += `; Max-Age=${opts.maxAge}`;
  s += `; Path=${opts.path || "/"}`;
  if (opts.httpOnly !== false) s += "; HttpOnly";
  s += `; SameSite=${opts.sameSite || "Lax"}`;
  if (opts.secure) s += "; Secure";
  return s;
}
function json(data, status = 200, cookies = []) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  const res = new Response(JSON.stringify(data), { status, headers });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}
function getSecret(env) {
  return env.SESSION_SECRET || `${env.SITE_PASSWORD || "default"}::session`;
}
// 开放注册开关：环境变量 OPEN_REGISTRATION 设为 0/false/off/no 即关闭，
// 关闭后仅管理员可在后台创建账户；未设置则默认开放。
function openRegistrationEnabled(env) {
  const v = (env.OPEN_REGISTRATION || "").toString().trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

// ---------- 密码哈希（PBKDF2）----------
async function hashPassword(password, iterations = 100000) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" }, km, 256
  );
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}
async function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = b64urlToBytes(parts[2]);
  const expected = parts[3];
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" }, km, 256
  );
  return constantTimeEqual(b64url(new Uint8Array(bits)), expected);
}

// ---------- DB 辅助 ----------
async function getUserById(env, id) {
  return env.DB.prepare("SELECT id, username, password_hash, role, created_at FROM users WHERE id = ?")
    .bind(id).first();
}
async function getUserByUsername(env, username) {
  return env.DB.prepare("SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?")
    .bind(username).first();
}
async function countUsers(env) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
  return r ? r.n : 0;
}
function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `u_${b64url(crypto.getRandomValues(new Uint8Array(12)))}`;
}

// ---------- 资产网关 ----------
// 动态给 HTML 注入同步脚本，避免改动上游原文件（保证自动更新时与 upstream 合并零冲突）
async function serveAsset(request, env) {
  const res = await env.ASSETS.fetch(request);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    let html = await res.text();
    const inject =
      '<script src="/auth/sync.js"></script>\n<script src="/auth/auth.js"></script>\n</body>';
    if (html.includes("</body>")) {
      html = html.replace("</body>", inject);
      const headers = new Headers(res.headers);
      headers.delete("content-length");
      return new Response(html, { status: res.status, headers });
    }
  }
  return res;
}
async function serveFile(req, env, relPath) {
  const url = new URL(req.url);
  url.pathname = relPath;
  return env.ASSETS.fetch(new Request(url.toString(), req));
}

// ---------- 认证态 ----------
async function getSiteAuth(req, env) {
  const t = getCookie(req, SITE_COOKIE);
  return t ? await verifyToken(t, getSecret(env)) : null;
}
async function getUserAuth(req, env) {
  const t = getCookie(req, USER_COOKIE);
  if (!t) return null;
  const data = await verifyToken(t, getSecret(env));
  if (!data) return null;
  const [id, role] = data.split(":");
  if (!id || !role) return null;
  const u = await getUserById(env, id);
  if (!u || u.role !== role) return null; // 用户被删/角色变更后令牌失效
  return u;
}

// ---------- API 路由 ----------
async function handleApi(request, env, path, method) {
  const p = path.slice(5); // 去掉 /api/
  const secret = getSecret(env);
  const secure = new URL(request.url).protocol === "https:";
  const siteAuth = await getSiteAuth(request, env);
  const user = await getUserAuth(request, env);

  // 站点密码登录（无需先认证）
  if (p === "site/login" && method === "POST") {
    if (!env.SITE_PASSWORD) {
      return json({ error: "服务端未配置 SITE_PASSWORD，请在 Cloudflare Pages 环境变量中设置" }, 500);
    }
    const body = await request.json().catch(() => ({}));
    if (body.password !== env.SITE_PASSWORD) return json({ error: "站点密码错误" }, 401);
    const token = await signToken("site", secret);
    const cookie = cookieStr(SITE_COOKIE, token, { maxAge: COOKIE_MAX_AGE, secure });
    return json({ ok: true }, 200, [cookie]);
  }
  if (p === "site/logout" && method === "POST") {
    const cookie = cookieStr(SITE_COOKIE, "", { maxAge: 0, secure });
    return json({ ok: true }, 200, [cookie]);
  }

  // 以下接口均需通过站点密码门禁
  if (!siteAuth) return json({ error: "需要站点密码", code: "SITE_REQUIRED" }, 401);

  // 站点配置（前端据此决定是否显示开放注册入口）
  if (p === "config" && method === "GET") {
    const n = await countUsers(env);
    return json({
      openRegistration: openRegistrationEnabled(env),
      bootstrapping: n === 0, // 数据库尚无任何用户，需要创建首位管理员
    });
  }

  // 用户注册（站点内开放；首个注册者=管理员）
  if (p === "user/register" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const username = (body.username || "").trim();
    if (!username) return json({ error: "用户名不能为空" }, 400);
    if (await getUserByUsername(env, username)) return json({ error: "用户名已存在" }, 409);
    const n = await countUsers(env);
    // 关闭开放注册后，仅允许「首次引导（创建首位管理员）」；其余必须由管理员在后台创建
    if (n > 0 && !openRegistrationEnabled(env)) {
      return json({ error: "开放注册已关闭，账户由管理员创建" }, 403);
    }
    const role = n === 0 ? "admin" : "user";
    const password_hash = body.password ? await hashPassword(body.password) : null;
    const id = newId();
    await env.DB.prepare(
      "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, username, password_hash, role, Date.now()).run();
    const token = await signToken(`${id}:${role}`, secret);
    const cookie = cookieStr(USER_COOKIE, token, { maxAge: COOKIE_MAX_AGE, secure });
    return json({ ok: true, role, username }, 200, [cookie]);
  }

  // 用户登录
  if (p === "user/login" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const username = (body.username || "").trim();
    const u = await getUserByUsername(env, username);
    if (!u) return json({ error: "用户不存在" }, 401);
    if (u.password_hash && !(await verifyPassword(body.password || "", u.password_hash)))
      return json({ error: "密码错误" }, 401);
    const token = await signToken(`${u.id}:${u.role}`, secret);
    const cookie = cookieStr(USER_COOKIE, token, { maxAge: COOKIE_MAX_AGE, secure });
    return json({ ok: true, role: u.role, username: u.username }, 200, [cookie]);
  }
  if (p === "user/logout" && method === "POST") {
    const cookie = cookieStr(USER_COOKIE, "", { maxAge: 0, secure });
    return json({ ok: true }, 200, [cookie]);
  }
  if (p === "user/me" && method === "GET") {
    if (!user) return json({ error: "未登录" }, 401);
    return json({ username: user.username, role: user.role });
  }

  // 以下均需登录
  if (!user) return json({ error: "请先登录", code: "USER_REQUIRED" }, 401);

  // 每用户数据读写
  if (p === "data" && method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT key, value FROM user_data WHERE user_id = ?"
    ).bind(user.id).all();
    const map = {};
    for (const r of rows.results || []) map[r.key] = r.value;
    return json(map);
  }
  if (p.startsWith("data/") && method === "PUT") {
    const key = decodeURIComponent(p.slice(5));
    if (!key) return json({ error: "key 不能为空" }, 400);
    const value = await request.text();
    await env.DB.prepare(
      "INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).bind(user.id, key, value, Date.now()).run();
    return json({ ok: true });
  }
  if (p.startsWith("data/") && method === "DELETE") {
    const key = decodeURIComponent(p.slice(5));
    await env.DB.prepare("DELETE FROM user_data WHERE user_id = ? AND key = ?")
      .bind(user.id, key).run();
    return json({ ok: true });
  }

  // 管理员：用户管理
  if (p === "users" && method === "GET") {
    if (user.role !== "admin") return json({ error: "需要管理员权限" }, 403);
    const rows = await env.DB.prepare(
      "SELECT id, username, role, created_at FROM users ORDER BY created_at ASC"
    ).all();
    return json(rows.results || []);
  }
  if (p === "users" && method === "POST") {
    if (user.role !== "admin") return json({ error: "需要管理员权限" }, 403);
    const body = await request.json().catch(() => ({}));
    const username = (body.username || "").trim();
    if (!username) return json({ error: "用户名不能为空" }, 400);
    if (await getUserByUsername(env, username)) return json({ error: "用户名已存在" }, 409);
    const password_hash = body.password ? await hashPassword(body.password) : null;
    const id = newId();
    await env.DB.prepare(
      "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, 'user', ?)"
    ).bind(id, username, password_hash, Date.now()).run();
    return json({ ok: true, id, username });
  }
  if (p.startsWith("users/") && method === "DELETE") {
    if (user.role !== "admin") return json({ error: "需要管理员权限" }, 403);
    const id = decodeURIComponent(p.slice(6));
    if (id === user.id) return json({ error: "不能删除自己" }, 400);
    await env.DB.prepare("DELETE FROM user_data WHERE user_id = ?").bind(id).run();
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}

// ---------- 入口 ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path.startsWith("/api/")) {
      return handleApi(request, env, path, method);
    }

    const siteAuth = await getSiteAuth(request, env);
    if (!siteAuth) return serveFile(request, env, "/auth/gate.html");

    const user = await getUserAuth(request, env);
    if (!user) return serveFile(request, env, "/auth/login.html");

    // 已完全认证：提供原始静态资源
    return serveAsset(request, env);
  },
};
