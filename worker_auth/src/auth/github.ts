import { Hono } from "hono";
import { Env } from "../types";

const auth = new Hono<{ Bindings: Env }>();

auth.get("/github", async (c) => {
  // 生成随机 state 防止 CSRF 攻击
  const state = crypto.randomUUID();
  const expires = new Date();
  expires.setMinutes(expires.getMinutes() + 10); // 10分钟过期

  // 存储 state 到 D1
  await c.env.DB.prepare(
    "INSERT INTO oauth_states (state, expires_at) VALUES (?, ?)"
  )
    .bind(state, expires.toISOString())
    .run();

  // 构建 GitHub 授权 URL
  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: `${new URL(c.req.url).origin}/auth/callback`,
    state,
    scope: "read:user user:email",
  });

  return c.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`
  );
});

export default auth;
