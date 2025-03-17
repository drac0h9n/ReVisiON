import { Context, Hono } from "hono";
import * as jose from "jose";
import {
  Env,
  GitHubOAuthTokenResponse,
  GitHubUserResponse,
  GitHubEmailResponse,
  Variables,
  User,
} from "../types";

// 创建 Hono 实例时正确指定泛型类型
const callback = new Hono<{ Bindings: Env; Variables: Variables }>();

callback.get("/", async (c) => {
  const { code, state } = c.req.query();

  // 添加本地开发模拟登录
  if (c.env.ENVIRONMENT === 'development' && code === 'TEST_CODE') {
    const mockUser = {
      id: 1,
      login: 'testuser',
      email: 'test@example.com',
      avatar_url: 'https://example.com/avatar'
    };
    c.set("userId", mockUser.id);
    return await handleMockUser(c, mockUser);
  }

  if (!code || !state) {
    return c.json({ error: "Missing required parameters" }, 400);
  }

  // 验证 state 防止 CSRF 攻击
  const stateRecord = await c.env.DB.prepare(
    "SELECT * FROM oauth_states WHERE state = ? AND expires_at > ?"
  )
    .bind(state, new Date().toISOString())
    .first();

  if (!stateRecord) {
    return c.json({ error: "Invalid or expired state" }, 400);
  }

  // 删除已使用的 state
  await c.env.DB.prepare("DELETE FROM oauth_states WHERE state = ?")
    .bind(state)
    .run();

  // 使用授权码交换访问令牌
  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${new URL(c.req.url).origin}/auth/callback`,
      }),
    }
  );

  // 使用正确的类型
  const tokenData = await tokenResponse.json<GitHubOAuthTokenResponse>();

  if (tokenData.error || !tokenData.access_token) {
    return c.json({ error: "Failed to exchange code for token" }, 400);
  }

  // 现在这里不会有类型错误
  c.set("accessToken", tokenData.access_token);
  return await handleUserData(c);
});

async function handleMockUser(c: Context, userData: any) {
  // 查找或创建用户
  let user = await c.env.DB.prepare("SELECT * FROM users WHERE github_id = ?")
    .bind(userData.id)
    .first();

  if (!user) {
    const result = await c.env.DB.prepare(
      "INSERT INTO users (github_id, username, email, avatar_url) VALUES (?, ?, ?, ?) RETURNING *"
    )
      .bind(userData.id, userData.login, userData.email, userData.avatar_url)
      .first();
    user = result;
  }
  
  c.set("userId", user.id);
  return await createSession(c);
}

async function handleUserData(c) {
  const accessToken = c.get("accessToken");

  // 使用访问令牌获取用户数据
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "CloudflareWorker-Auth",
    },
  });

  const userData = await userResponse.json<GitHubUserResponse>();

  if (!userData.id) {
    return c.json({ error: "Failed to get user data" }, 400);
  }

  // 获取用户邮箱
  const emailResponse = await fetch("https://api.github.com/user/emails", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "CloudflareWorker-Auth",
    },
  });

  const emails = (await emailResponse.json()) as GitHubEmailResponse[];
  const primaryEmail =
    emails.find((email) => email.primary)?.email || emails[0]?.email;

  // 查找用户或创建新用户
  let user = await c.env.DB.prepare("SELECT * FROM users WHERE github_id = ?")
    .bind(userData.id)
    .first();

  if (!user) {
    // 创建新用户
    const result = await c.env.DB.prepare(
      "INSERT INTO users (github_id, username, email, avatar_url) VALUES (?, ?, ?, ?) RETURNING *"
    )
      .bind(userData.id, userData.login, primaryEmail, userData.avatar_url)
      .first();
    user = result;
  } else {
    // 更新现有用户
    await c.env.DB.prepare(
      "UPDATE users SET username = ?, email = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    )
      .bind(userData.login, primaryEmail, userData.avatar_url, user.id)
      .run();
  }

  // 存储用户ID用于生成JWT
  c.set("userId", user.id);
  return await createSession(c);
}

// 这里也需要修复
async function createSession(c) {
  const userId = c.get("userId");

  // 创建 JWT
  const tokenId = crypto.randomUUID();
  const expiresIn = 60 * 60 * 24 * 7; // 7天
  const expires = new Date(Date.now() + expiresIn * 1000);

  const secret = new TextEncoder().encode(c.env.JWT_SECRET);
  const token = await new jose.SignJWT({
    sub: userId.toString(),
    jti: tokenId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expires.getTime() / 1000)
    .sign(secret);

  // 存储会话到数据库
  await c.env.DB.prepare(
    "INSERT INTO sessions (user_id, token_id, expires_at) VALUES (?, ?, ?)"
  )
    .bind(userId, tokenId, expires.toISOString())
    .run();

  // 设置安全的 HTTP-only cookie
  c.header(
    "Set-Cookie",
    `auth=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=${expires.toUTCString()}`
  );

  // 重定向到前端应用
  return c.redirect("/");
}

export default callback;
