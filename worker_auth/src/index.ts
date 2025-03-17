import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie } from "hono/cookie";
import * as jose from "jose";
import { Env, Variables } from "./types";
import githubAuth from "./auth/github";
import callbackHandler from "./auth/callback";
import { authMiddleware } from "./middleware/auth";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 启用CORS
app.use(
  cors({
    origin: ["http://localhost:3000", "https://yourdomain.com"],
    credentials: true,
  })
);

// 认证路由
app.route("/auth", githubAuth);
app.route("/auth/callback", callbackHandler);

// 登出路由
app.get("/auth/logout", async (c) => {
  // 修改这里：从 c.req 改为 c
  const authCookie = getCookie(c, "auth");
  if (authCookie) {
    try {
      const secret = new TextEncoder().encode(c.env.JWT_SECRET);
      const { payload } = await jose.jwtVerify(authCookie, secret);

      // 从数据库中删除会话
      if (payload.jti) {
        await c.env.DB.prepare("DELETE FROM sessions WHERE token_id = ?")
          .bind(payload.jti)
          .run();
      }
    } catch (e) {
      // 忽略令牌验证错误，继续登出流程
    }
  }

  // 清除 cookie
  setCookie(c, "auth", "", {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    expires: new Date(0),
  });
  return c.redirect("/");
});

// 受保护的 API 路由
app.get("/api/me", authMiddleware, async (c) => {
  // 用户数据已在中间件中设置
  const user = c.get("user");
  return c.json(user);
});

// 主页
app.get("/", async (c) => {
  return c.html(`
	  <!DOCTYPE html>
	  <html>
		<head>
		  <title>GitHub Auth Demo</title>
		</head>
		<body>
		  <h1>GitHub Auth Demo</h1>
		  <a href="/auth/github">Login with GitHub</a>
		  <div id="user-info"></div>
		  <script>
			// 简单的前端逻辑检查登录状态
			fetch('/api/me', { credentials: 'include' })
			  .then(res => {
				if (res.ok) return res.json();
				throw new Error('Not authenticated');
			  })
			  .then(user => {
				document.getElementById('user-info').innerHTML = 
				  \`<p>Logged in as \${user.username}</p>
				   <img src="\${user.avatar_url}" width="50">
				   <p><a href="/auth/logout">Logout</a></p>\`;
			  })
			  .catch(err => console.log('Not logged in'));
		  </script>
		</body>
	  </html>
	`) as Response; // 添加类型断言
});

export default app;
