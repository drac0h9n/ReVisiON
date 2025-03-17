import { Context } from "hono";
import * as jose from "jose";
import { Env, Variables, User } from "../types";
import { getCookie } from "hono/cookie";

export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next
) {
  try {
    // 获取 cookie 中的 token
    const authCookie = getCookie(c, "auth");
    if (!authCookie) {
      return c.json({ error: "Unauthorized - No token provided" }, 401);
    }

    // 验证 JWT
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jose.jwtVerify(authCookie, secret);

    if (!payload.sub || !payload.jti) {
      return c.json({ error: "Invalid token format" }, 401);
    }

    // 验证数据库中的会话
    const session = await c.env.DB.prepare(
      "SELECT * FROM sessions WHERE user_id = ? AND token_id = ? AND expires_at > ?"
    )
      .bind(payload.sub, payload.jti, new Date().toISOString())
      .first();

    if (!session) {
      return c.json({ error: "Invalid or expired session" }, 401);
    }

    // 获取用户数据
    const userResult = await c.env.DB.prepare(
      "SELECT id, username, email, avatar_url FROM users WHERE id = ?"
    )
      .bind(payload.sub)
      .first();

    if (!userResult) {
      return c.json({ error: "User not found" }, 401);
    }

    // 安全地将数据库结果转换为 User 类型
    const user: User = {
      id:
        typeof userResult.id === "number"
          ? userResult.id
          : parseInt(userResult.id as string),
      username: userResult.username as string,
      email: userResult.email as string,
      avatar_url: userResult.avatar_url as string | undefined,
    };

    // 设置用户上下文
    c.set("user", user);
    await next();
  } catch (err) {
    // 处理令牌验证错误
    console.error("Auth error:", err);
    return c.json({ error: "Unauthorized - Invalid token" }, 401);
  }
}
