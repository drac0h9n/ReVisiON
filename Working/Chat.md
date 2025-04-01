我希望跟你一起对 Command + Shift + Q 呼出的 Query Page 进行功能设计（设计使用中文），仅进行设计而不进行任何的代码编程。

1.我希望用户在按下快捷键后会截图整个屏幕，截图的缩略图会出现在 Query Page(很小的缩略图)，用户点击后可以跟 ScreenShotPage 一样放大进行 Preview 2.我希望用户发出的消息以及收到的回复有明显的区分度，Apple 风格。任何信息中的 Markdown 代码都需要使用 Markdown 渲染器进行渲染，且支持一键 Copy Markdown 代码块中的代码。 3.我希望用户发出的“图片+文字”信息发送到 Worker，由 Worker 进行发送者的认证，并由 Worker 将"图片+文字"按照 OpenAI API 格式发送到自定义 API Url 以及 Key 值对应的服务器。

当前 Tauri + Worker 代码如下

```worker
src-worker/src/db/schema.sql:
-- schema.sql
-- Defines the schema for the github_users table in the D1 database.

-- Create the table only if it doesn't already exist.
CREATE TABLE IF NOT EXISTS github_users (
-- Primary Key: The unique identifier from GitHub.
github_id INTEGER PRIMARY KEY,

    -- GitHub login/username. Should be unique across GitHub.
    -- Marked as NOT NULL and UNIQUE.
    login TEXT NOT NULL UNIQUE,

    -- User's display name from GitHub (can be null).
    name TEXT,

    -- URL to the user's avatar image (should generally exist, but allow NULL defensively).
    avatar_url TEXT,

    -- User's public email from GitHub (can be null or not provided).
    email TEXT,

    -- Timestamp when the user was first synced to our database.
    -- Defaults to the time the row is inserted.
    first_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Timestamp when the user's information was last updated in our database.
    -- Should be updated every time a sync occurs.
    last_synced_at TIMESTAMP NOT NULL

);

-- Optional: You could add indexes here later for performance if needed, e.g.:
-- CREATE INDEX IF NOT EXISTS idx_users_last_synced ON github_users(last_synced_at);

-- npx wrangler d1 execute github-users-db --remote --file=./schema.sql

src-worker/src/auth.ts:
// src/auth.ts

import { Env } from "./types";
import { errorResponse } from "./utils";

/\*\*

- Authenticates the incoming request based on the Authorization header.
- @param request - The incoming Request object.
- @param env - The Worker environment variables.
- @returns `null` if authentication is successful, otherwise a `Response` object indicating the error.
  \*/
  export function authenticateRequest(
  request: Request,
  env: Env
  ): Response | null {
  const authHeader = request.headers.get("Authorization");
  const expectedApiKey = env.WORKER_API_KEY;

if (!expectedApiKey) {
console.error("CRITICAL: WORKER_API_KEY environment variable not set!");
return errorResponse(
"Internal Server Error: API Key configuration missing",
500
);
}

if (!authHeader || !authHeader.startsWith("Bearer ")) {
return errorResponse(
"Unauthorized: Missing or malformed Authorization header",
401
);
}

const providedKey = authHeader.substring(7); // Extract key after "Bearer "

if (providedKey !== expectedApiKey) {
return errorResponse("Unauthorized: Invalid API Key", 401);
}

// Authentication successful
return null;
}

src-worker/src/db.ts:
// src/db.ts

import { GithubUserProfile, Env } from "./types";

/\*\*

- Upserts (Inserts or Updates) the GitHub user profile into the D1 database.
- @param profile - The GitHub user profile data.
- @param db - The D1Database instance from the environment.
- @returns A Promise that resolves with the D1Result on success.
- @throws An error if the database operation fails.
  \*/
  export async function upsertUserProfile(
  profile: GithubUserProfile,
  db: D1Database
  ): Promise<D1Result> {
  const now = new Date().toISOString(); // Use ISO 8601 format for timestamps

// SQL statement for Upsert using ON CONFLICT (SQLite syntax)
const upsertSql = `        INSERT INTO github_users (
            github_id,
            login,
            name,
            avatar_url,
            email,
            last_synced_at
            -- first_synced_at is handled by DEFAULT CURRENT_TIMESTAMP on the table
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(github_id) DO UPDATE SET
            login = excluded.login,
            name = excluded.name,
            avatar_url = excluded.avatar_url,
            email = excluded.email,
            last_synced_at = excluded.last_synced_at;
   `;

try {
const stmt = db.prepare(upsertSql);
const info = await stmt
.bind(
profile.id,
profile.login,
profile.name ?? null, // Use null for undefined/null optional values
profile.avatar_url ?? null, // Use null if avatar_url can potentially be null/undefined
profile.email ?? null, // Use null for undefined/null optional values
now // Update last_synced_at timestamp
)
.run(); // Use run() for INSERT/UPDATE/DELETE

    console.log(
      `Successfully upserted user ID: ${profile.id}. D1 meta: ${JSON.stringify(
        info.meta
      )}`
    );
    return info;

} catch (e: any) {
console.error(
`Database upsert failed for user ID ${profile.id}: ${e.message}`,
e.stack
);
// Re-throw the error to be caught by the main handler
throw new Error(`Database operation failed: ${e.message}`);
}
}

/\*\*

- Optional: Function to create the table if it doesn't exist.
- You would typically run this once via wrangler d1 execute or manually.
- It could be called defensively, but adds overhead to every request.
  \*/
  export async function ensureTableExists(db: D1Database): Promise<void> {
  const createTableSql = `        CREATE TABLE IF NOT EXISTS github_users (
            github_id INTEGER PRIMARY KEY,
            login TEXT NOT NULL UNIQUE, -- Add UNIQUE constraint if login should be unique too
            name TEXT,
            avatar_url TEXT,
            email TEXT,
            first_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_synced_at TIMESTAMP NOT NULL
        );
   `;
  try {
  await db.exec(createTableSql);
  console.log("Table 'github_users' checked/created successfully.");
  } catch (e: any) {
  console.error(`Failed to ensure table exists: ${e.message}`);
  // Decide how to handle this - maybe throw?
  }
  }

src-worker/src/index.ts:
// src/index.ts

import { Env, BackendSyncPayload, ApiResponse } from "./types";
import { jsonResponse, errorResponse } from "./utils";
import { authenticateRequest } from "./auth";
import { upsertUserProfile /_, ensureTableExists _/ } from "./db";

export default {
/\*\*

- Handles incoming fetch events.
- @param request - The incoming request.
- @param env - Environment variables (including bindings).
- @param ctx - Execution context.
- @returns A Response promise.
  \*/
  async fetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext
  ): Promise<Response> {
  // Optional: Ensure table exists on first request or periodically.
  // Be mindful of performance implications if called on every request.
  // ctx.waitUntil(ensureTableExists(env.DB));


    const url = new URL(request.url);

    // --- Basic Routing & Method Check ---
    if (url.pathname !== "/sync-user") {
      return errorResponse("Not Found", 404);
    }
    if (request.method !== "POST") {
      return errorResponse("Method Not Allowed", 405);
    }

    try {
      // --- Authentication ---
      const authErrorResponse = authenticateRequest(request, env);
      if (authErrorResponse) {
        return authErrorResponse; // Return 401/500 response if authentication fails
      }
      console.log("Request authenticated successfully.");

      // --- Request Body Parsing & Validation ---
      if (request.headers.get("Content-Type") !== "application/json") {
        return errorResponse(
          "Bad Request: Expected Content-Type: application/json",
          400
        );
      }

      let payload: BackendSyncPayload;
      try {
        payload = await request.json<BackendSyncPayload>();
      } catch (e: any) {
        return errorResponse(
          `Bad Request: Invalid JSON payload - ${e.message}`,
          400
        );
      }

      // Basic payload validation
      if (!payload?.profile?.id || !payload?.profile?.login) {
        return errorResponse(
          "Bad Request: Missing required fields in profile (id, login)",
          400
        );
      }
      console.log(`Received valid payload for user ID: ${payload.profile.id}`);

      // --- Database Interaction ---
      try {
        await upsertUserProfile(payload.profile, env.DB);

        // --- Success Response ---
        console.log(
          `Sync process completed successfully for user ID: ${payload.profile.id}`
        );
        // Return simple success message
        return jsonResponse<null>(
          { message: "User profile synced successfully." },
          200
        );
        // Or return the profile data if the client needs confirmation
        // return jsonResponse<GithubUserProfile>({ data: payload.profile }, 200);
      } catch (dbError: any) {
        // Error during DB operation (already logged in db.ts)
        return errorResponse(
          dbError.message || "Database operation failed",
          500
        );
      }
    } catch (e: any) {
      // --- Catch-all for unexpected errors ---
      console.error(
        "Unhandled error during request processing:",
        e.message,
        e.stack
      );
      return errorResponse("Internal Server Error", 500);
    }

},
};

src-worker/src/types.ts:
// src/types.ts

/\*\*

- Environment variables expected by the Worker.
- These are configured in wrangler.toml or via Cloudflare Dashboard secrets.
  \*/
  export interface Env {
  /\*\*
  - D1 Database binding. Provides access to the database instance.
    \*/
    DB: D1Database;

/\*\*

- The secret API key expected in the Authorization header from the Tauri backend.
- Should be set as a secret using `wrangler secret put WORKER_API_KEY`.
  \*/
  WORKER_API_KEY: string;
  }

/\*\*

- Represents the structure of the user profile data received from GitHub,
- mirroring the Rust `GithubUserProfile` struct.
  \*/
  export interface GithubUserProfile {
  login: string;
  id: number; // Use number for u64 from Rust
  name?: string | null; // Optional fields can be string or null
  avatar_url: string; // Assuming this is always present based on Rust struct (handle null defensively if needed)
  email?: string | null; // Optional fields can be string or null
  }

/\*\*

- Represents the expected payload structure in the POST request body
- from the Tauri backend, mirroring the Rust `BackendSyncPayload`.
  \*/
  export interface BackendSyncPayload {
  profile: GithubUserProfile;
  // Include other fields if the Rust backend sends them, e.g.:
  // access_token?: string;
  }

/\*\*

- Standard structure for API JSON responses.
  \*/
  export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  }

src-worker/src/utils.ts:
// src/utils.ts

import { ApiResponse } from "./types";

/\*\*

- Creates a standard JSON Response object.
- @param data - The data payload for the response.
- @param status - The HTTP status code (default: 200).
- @param headers - Additional headers to include.
- @returns A Response object.
  \*/
  export function jsonResponse<T>(
  data: ApiResponse<T> | Omit<ApiResponse<T>, "success">, // Allow omitting success, defaults based on status
  status: number = 200,
  headers: HeadersInit = {}
  ): Response {
  const body: ApiResponse<T> = {
  success: status >= 200 && status < 300, // Infer success from status code
  ...data,
  };

return new Response(JSON.stringify(body), {
status: status,
headers: {
"Content-Type": "application/json",
...headers,
},
});
}

/\*\*

- Creates an error JSON Response object.
- @param message - The error message.
- @param status - The HTTP error status code (default: 500).
- @returns A Response object.
  \*/
  export function errorResponse(message: string, status: number = 500): Response {
  console.error(`Error Response (${status}): ${message}`); // Log the error server-side
  return jsonResponse({ message }, status); // success will be false due to status code
  }
```

```tauri(react frontend)
src/App.tsx:
// src/App.tsx
import { useEffect, useRef } from "react"; // <-- 引入 useRef
import { Routes, Route } from "react-router-dom";
import { message } from "antd"; // <-- 引入 antd message

// 应用内组件
import GitHubAuth from "@/login/GitHubAuth";
import ScreenshotPage from "@/screenshot/ScreenshotPage";
import { setupTray, cleanupTray } from "@/core/tray";

// Tauri API 和插件
import {
  register,
  unregister,
  isRegistered,
} from "@tauri-apps/plugin-global-shortcut"; // <-- 引入全局快捷键 API
import {
  WebviewWindow,
  getAllWebviewWindows,
} from "@tauri-apps/api/webviewWindow"; // <-- 引入 WebviewWindow API

// 样式
import "./App.css";

// --- 新增常量 ---
const QUERY_HOTKEY = "CmdOrCtrl+Shift+Q"; // 定义查询窗口的快捷键
const QUERY_WINDOW_LABEL = "screenshot_query_window"; // 定义查询窗口的唯一标签
const QUERY_WINDOW_URL = "screenshot_query.html"; // 定义查询窗口加载的 HTML 文件

function App() {
  // --- 新增 Refs ---
  const isRegisteringRef = useRef(false); // 防止并发注册快捷键
  const isProcessingHotkeyRef = useRef(false); // 防止快捷键处理过程中的并发问题

  // --- 新增函数：处理打开或聚焦查询窗口 ---
  const openOrFocusQueryWindow = async () => {
    if (isProcessingHotkeyRef.current) {
      console.warn(`[Hotkey] 操作已在进行中，忽略本次触发。`);
      return;
    }
    isProcessingHotkeyRef.current = true;
    console.log(`[Hotkey] 快捷键 ${QUERY_HOTKEY} 已触发，正在处理...`);

    try {
      // 检查窗口是否已存在
      const allWindows = await getAllWebviewWindows();
      const existingWindow = allWindows.find(
        (win) => win.label === QUERY_WINDOW_LABEL
      );

      if (existingWindow) {
        console.log(`[Hotkey] 窗口 "${QUERY_WINDOW_LABEL}" 已存在，尝试聚焦。`);
        // 如果窗口存在，尝试取消最小化、显示并聚焦
        if (await existingWindow.isMinimized()) {
          await existingWindow.unminimize();
          console.log(`[Hotkey] 窗口 "${QUERY_WINDOW_LABEL}" 已取消最小化。`);
        }
        if (!(await existingWindow.isVisible())) {
          await existingWindow.show();
          console.log(`[Hotkey] 窗口 "${QUERY_WINDOW_LABEL}" 已显示。`);
        }
        await existingWindow.setFocus();
        console.log(`[Hotkey] 窗口 "${QUERY_WINDOW_LABEL}" 已聚焦。`);
        message.info("查询窗口已聚焦", 1.5);
      } else {
        console.log(
          `[Hotkey] 窗口 "${QUERY_WINDOW_LABEL}" 未找到，正在创建新窗口...`
        );
        // 如果窗口不存在，创建新窗口
        const webviewWindow = new WebviewWindow(QUERY_WINDOW_LABEL, {
          url: QUERY_WINDOW_URL, // 加载指定的 HTML 文件
          title: "Screenshot Query", // 设置窗口标题
          width: 450, // 设置初始宽度
          height: 350, // 设置初始高度
          resizable: true, // 允许调整大小
          decorations: true, // 显示窗口装饰（标题栏、边框）
          alwaysOnTop: false, // 默认不置顶
          center: true, // 创建时居中
          focus: true, // 创建后自动获得焦点
          // theme: 'light',            // 可选：强制主题
          // transparent: false,       // 可选：是否透明
        });

        // 监听创建成功事件
        webviewWindow.once("tauri://created", () => {
          console.log(`[Hotkey] 窗口 "${QUERY_WINDOW_LABEL}" 创建成功。`);
          message.success("查询窗口已打开", 1.5);
        });

        // 监听创建错误事件
        webviewWindow.once("tauri://error", (e) => {
          console.error(`[Hotkey] 创建窗口 "${QUERY_WINDOW_LABEL}" 失败:`, e);
          message.error(`打开查询窗口失败: ${e}`);
        });
      }
    } catch (error) {
      console.error("[Hotkey] 处理查询窗口时出错:", error);
      message.error(
        `处理查询窗口时出错: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      isProcessingHotkeyRef.current = false; // 释放处理锁
      console.log(`[Hotkey] 处理逻辑执行完毕。`);
    }
  };

  useEffect(() => {
    console.log("[App.tsx] 组件挂载，开始执行 useEffect...");
    let trayCleanupFunc: (() => void) | null = null;
    let isHotkeyRegisteredInThisEffect = false; // <-- 新增：跟踪快捷键注册状态

    // --- 托盘设置逻辑 (保持不变) ---
    console.log("[App.tsx] 正在调用 setupTray...");
    setupTray()
      .then((unlisten) => {
        console.log("[App.tsx] setupTray Promise 解析成功。");
        if (unlisten && typeof unlisten === "function") {
          trayCleanupFunc = unlisten;
          console.log("[App.tsx] 已收到托盘 unlisten 函数。");
        } else {
          console.warn(
            "[App.tsx] setupTray 已解析但未返回有效的 unlisten 函数。"
          );
        }
      })
      .catch((error) => {
        console.error("[App.tsx] 调用 setupTray 时出错:", error);
      });

    // --- 新增：快捷键注册管理逻辑 ---
    const manageHotkey = async () => {
      if (isRegisteringRef.current) {
        console.log("[Effect] 快捷键注册已在进行中，跳过本次。");
        return;
      }
      isRegisteringRef.current = true;
      console.log("[Effect] 正在管理快捷键注册...");

      try {
        // 防御性注销：检查是否已注册（可能来自非正常关闭）
        if (await isRegistered(QUERY_HOTKEY)) {
          console.log(
            `[Effect] 快捷键 ${QUERY_HOTKEY} 可能已存在，先尝试注销。`
          );
          await unregister(QUERY_HOTKEY);
          console.log(`[Effect] 防御性注销 ${QUERY_HOTKEY} 成功。`);
        }

        // 注册快捷键
        console.log(`[Effect] 正在注册快捷键: ${QUERY_HOTKEY}`);
        await register(QUERY_HOTKEY, () => {
          // 快捷键回调应尽可能轻量，将复杂逻辑委托给其他函数
          console.log(`[Effect] 检测到快捷键 ${QUERY_HOTKEY} 按下。`);
          openOrFocusQueryWindow(); // 调用实际的处理函数
        });
        isHotkeyRegisteredInThisEffect = true; // 标记本 effect 成功注册
        console.log(`[Effect] 快捷键 ${QUERY_HOTKEY} 注册成功。`);
        // 可选：给用户一个提示
        // message.info(`查询快捷键 (${QUERY_HOTKEY}) 已激活`, 2);
      } catch (err) {
        console.error(`[Effect] 注册快捷键 ${QUERY_HOTKEY} 失败:`, err);
        message.error(`快捷键 ${QUERY_HOTKEY} 可能已被其他程序占用。`);
        isHotkeyRegisteredInThisEffect = false; // 标记注册失败
      } finally {
        isRegisteringRef.current = false; // 释放注册锁
        console.log("[Effect] 快捷键管理流程结束。");
      }
    };

    // 触发快捷键注册管理
    manageHotkey();

    // --- 清理函数 ---
    return () => {
      console.log("[App.tsx] 组件即将卸载，执行清理...");

      // --- 清理托盘 ---
      // Option 1: 调用 setupTray 返回的特定清理函数
      if (trayCleanupFunc) {
        console.log(
          "[App.tsx] 正在调用 setupTray 返回的特定清理函数 (unlisten)..."
        );
        try {
          trayCleanupFunc();
        } catch (error) {
          console.error("[App.tsx] 调用特定托盘清理函数时出错:", error);
        }
      } else {
        console.log("[App.tsx] 没有收到或无法调用特定的托盘清理函数。");
      }

      // Option 2: 调用通用的托盘清理函数
      console.log("[App.tsx] 正在调用通用 cleanupTray...");
      try {
        cleanupTray();
        console.log("[App.tsx] cleanupTray 调用成功。");
      } catch (error) {
        console.error("[App.tsx] 调用通用 cleanupTray 时出错:", error);
      }

      // --- 新增：清理快捷键 ---
      console.log("[App.tsx] 正在清理快捷键...");
      if (isHotkeyRegisteredInThisEffect) {
        console.log(
          `[App.tsx Cleanup] 尝试注销由本 effect 注册的快捷键 ${QUERY_HOTKEY}...`
        );
        unregister(QUERY_HOTKEY)
          .then(() =>
            console.log(`[App.tsx Cleanup] 快捷键 ${QUERY_HOTKEY} 注销成功。`)
          )
          .catch((err) =>
            console.error(
              `[App.tsx Cleanup] 注销快捷键 ${QUERY_HOTKEY} 失败:`,
              err
            )
          );
      } else {
        console.log(
          `[App.tsx Cleanup] 跳过快捷键注销，因为它未被本 effect 成功注册。`
        );
      }

      // --- 重置 Refs ---
      isRegisteringRef.current = false;
      isProcessingHotkeyRef.current = false;

      console.log("[App.tsx] 清理流程结束。");
    };
  }, []); // 空依赖数组确保只在挂载和卸载时运行

  return (
    <div className="AppContainer">
      <Routes>
        <Route path="/" element={<GitHubAuth />} />
        <Route path="/screenshot" element={<ScreenshotPage />} />
      </Routes>
    </div>
  );
}

export default App;

src/main.tsx:
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
// Import BrowserRouter
import { BrowserRouter } from "react-router-dom";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* Wrap App with BrowserRouter */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

src/hooks/useGitHubAuth.ts:
// src/hooks/useGitHubAuth.ts
import { useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

// 导入 Zustand Store 和相关类型
import {
  useAuthStore,
  type GitHubProfile,
  type AuthStatus,
} from "@/store/authStore"; // 确保导入 AuthStatus

// 定义 Hook 返回值的类型 (使用从 Store 推断的类型)
interface UseGitHubAuthReturn {
  authState: AuthStatus; // 使用导入的 AuthStatus
  userProfile: GitHubProfile | null;
  authError: string | null;
  login: () => Promise<void>;
  logout: () => void;
}

export function useGitHubAuth(): UseGitHubAuthReturn {
  // --- 1. 从 Zustand Store 获取状态和 Actions ---
  const {
    authState,
    userProfile,
    authError,
    loginStart, // 获取 Store 的 action
    loginSuccess, // 获取 Store 的 action
    loginFailure, // 获取 Store 的 action
    logout: storeLogout, // 获取 Store 的 action (重命名以防与 hook 返回的 logout 冲突)
  } = useAuthStore();

  // --- Refs for listeners (保持不变) ---
  const unlistenSuccessRef = useRef<UnlistenFn | null>(null);
  const unlistenErrorRef = useRef<UnlistenFn | null>(null);

  // --- 2. useEffect for listeners (调用 Store Actions) ---
  useEffect(() => {
    let isMounted = true;
    console.log("[Hook] Setting up auth event listeners...");

    const setupListeners = async () => {
      try {
        // --- 成功监听器: 调用 loginSuccess Action ---
        const successListener = await listen<{ profile: GitHubProfile }>(
          "github_auth_success",
          (event) => {
            if (isMounted) {
              console.log(
                "[Hook] Received github_auth_success event:",
                event.payload
              );
              // 调用 Store Action 更新全局状态
              loginSuccess(event.payload.profile);
            }
          }
        );

        // --- 错误监听器: 调用 loginFailure Action ---
        const errorListener = await listen<any>(
          "github_auth_error",
          (event) => {
            if (isMounted) {
              console.error(
                "[Hook] Received github_auth_error event:",
                event.payload
              );
              // (错误消息处理逻辑保持不变)
              let errorMessage = "Authentication failed. Please try again.";
              if (event.payload && typeof event.payload === "object") {
                const errorKey = Object.keys(event.payload)[0];
                if (errorKey && typeof event.payload[errorKey] === "string") {
                  errorMessage = `${errorKey}: ${event.payload[errorKey]}`;
                } else if (errorKey) {
                  errorMessage = `Authentication failed: ${errorKey}`;
                }
              } else if (typeof event.payload === "string") {
                errorMessage = event.payload;
              }
              // 调用 Store Action 更新全局状态
              loginFailure(errorMessage);
            }
          }
        );

        unlistenSuccessRef.current = successListener;
        unlistenErrorRef.current = errorListener;
        console.log("[Hook] Auth event listeners successfully attached.");
      } catch (error) {
        console.error("[Hook] Failed to attach auth listeners:", error);
        if (isMounted) {
          // 也可以选择调用 loginFailure 来设置初始错误状态
          loginFailure(
            `Failed to initialize listeners: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    };

    // 仅在第一次渲染时设置监听器
    // 如果 authState 已经是 'success' 或 'loading' (可能来自持久化)，不需要重新设置？
    // => 监听器通常应该总是设置，因为它们响应 Tauri 后端事件，无论当前状态如何。
    // 例如，即使用户已登录，也可能需要处理错误事件（比如 token 失效）。
    setupListeners();

    // 清理函数 (保持不变)
    return () => {
      isMounted = false;
      console.log("[Hook] Cleaning up auth listeners...");
      if (unlistenSuccessRef.current) {
        unlistenSuccessRef.current();
        console.log("[Hook] Success listener detached.");
      }
      if (unlistenErrorRef.current) {
        unlistenErrorRef.current();
        console.log("[Hook] Error listener detached.");
      }
    };
    // 依赖项为 store actions，因为它们是稳定的引用 (由 Zustand 保证)
    // 但如果它们在 store 定义中改变，这里需要更新。
  }, [loginSuccess, loginFailure]);

  // --- 3. login 函数 (调用 Store Actions) ---
  const login = useCallback(async () => {
    // 调用 Store Action 设置 loading 状态并清除旧数据
    loginStart();
    try {
      console.log("[Hook] Invoking 'login_with_github' command...");
      const authUrl = await invoke<string>("login_with_github");
      console.log("[Hook] Received auth URL, opening:", authUrl);
      await openUrl(authUrl);
      console.log("[Hook] Auth URL opened. Waiting for backend events...");
    } catch (error: any) {
      console.error(
        "[Hook] Failed to initiate GitHub login or open URL:",
        error
      );
      const message = `Login initiation failed: ${
        error?.message || String(error)
      }`;
      // 调用 Store Action 设置 error 状态
      loginFailure(message);
    }
  }, [loginStart, loginFailure]); // 依赖于 store actions

  // --- 4. logout 函数 (调用 Store Action) ---
  const logout = useCallback(() => {
    console.log("[Hook] Logout requested. Calling store logout action.");
    // 调用 Store 的 logout Action 来重置状态
    storeLogout();
    // 本地不需要做其他状态清理，由 store 负责
  }, [storeLogout]); // 依赖于 store action

  // --- 5. 返回从 Store 读取的状态和 Hook 封装的 Actions ---
  return {
    authState,
    userProfile,
    authError,
    login,
    logout,
  };
}

src/login/GitHubAuth.tsx:
// src/login/GitHubAuth.tsx
// Import useNavigate
import { useNavigate } from "react-router-dom";
import { useGitHubAuth } from "@/hooks/useGitHubAuth";
import { FaGithub } from "react-icons/fa";
import { FiLogOut, FiMail, FiUser, FiCamera } from "react-icons/fi"; // Added FiCamera

function GitHubAuth() {
  const { authState, userProfile, authError, login, logout } = useGitHubAuth();
  const navigate = useNavigate(); // Initialize navigate hook

  const goToScreenshotPage = () => {
    navigate("/screenshot"); // Navigate to the screenshot route
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden transition-all duration-300">
        {/* Header */}
        <div className="bg-indigo-600 dark:bg-indigo-700 px-6 py-4">
          <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
            <FaGithub className="text-2xl" />
            <span>GitHub Authentication</span>
          </h1>
        </div>

        {/* Content Area */}
        <div className="p-6">
          {/* Loading State */}
          {authState === "loading" && (
            // ... loading indicator ...
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
              <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-600 dark:text-gray-300 text-lg font-medium">
                Connecting to GitHub...
              </p>
            </div>
          )}

          {/* Error Message */}
          {authError && (
            // ... error display ...
            <div className="mb-6 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-4 rounded-md">
              {/* ... error content ... */}
              <div className="flex">
                <div className="flex-shrink-0">
                  {/* SVG Icon */}
                  <svg
                    className="h-5 w-5 text-red-500"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">
                    Authentication Error
                  </p>
                  <p className="mt-1 text-sm text-red-600 dark:text-red-500">
                    {authError}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Authenticated - Show User Profile AND Navigation Button */}
          {authState === "success" && userProfile && (
            <div className="flex flex-col items-center space-y-6">
              {/* ... user profile display ... */}
              <div className="relative">
                <img
                  src={userProfile.avatar_url}
                  alt={`${userProfile.login}'s avatar`}
                  className="w-24 h-24 rounded-full ring-4 ring-indigo-500 ring-offset-2 dark:ring-offset-gray-800"
                />
                {/* ... green checkmark ... */}
                <div className="absolute bottom-0 right-0 bg-green-500 p-1 rounded-full border-2 border-white dark:border-gray-800">
                  <svg
                    className="w-3 h-3 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              </div>
              <div className="text-center space-y-2">
                {/* ... name, username, email, id ... */}
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                  {userProfile.name || userProfile.login}
                </h2>
                <div className="flex items-center justify-center text-gray-500 dark:text-gray-400">
                  <FiUser className="mr-1" />
                  <span>@{userProfile.login}</span>
                </div>
                {userProfile.email && (
                  <div className="flex items-center justify-center text-gray-500 dark:text-gray-400">
                    <FiMail className="mr-1" />
                    <span>{userProfile.email}</span>
                  </div>
                )}
                <div className="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300 py-1 px-2 rounded-full inline-block">
                  ID: {userProfile.id}
                </div>
              </div>
              {/* ------- Action Buttons ------- */}
              <div className="w-full mt-6 space-y-3">
                {" "}
                {/* Container for buttons */}
                {/* --> NEW: Navigation Button <-- */}
                <button
                  onClick={goToScreenshotPage}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white transition-colors duration-300 font-medium py-2.5 px-4 rounded-lg"
                >
                  <FiCamera />
                  <span>Go to Screenshot Page</span>
                </button>
                {/* Sign Out Button */}
                <button
                  onClick={logout}
                  className="w-full flex items-center justify-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white transition-colors duration-300 font-medium py-2.5 px-4 rounded-lg"
                >
                  <FiLogOut />
                  <span>Sign Out</span>
                </button>
              </div>{" "}
              {/* End Action Buttons Container */}
            </div>
          )}

          {/* Not Logged In or Error - Show Login Button */}
          {(authState === "idle" || authState === "error") && (
            <div className="flex flex-col items-center space-y-4">
              {authState === "idle" && !authError && (
                <p className="text-gray-600 dark:text-gray-400">
                  Please sign in to continue.
                </p>
              )}
              {/* Only show login button if not loading */}
              <button
                onClick={login}
                className="w-full mt-2 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white transition-colors duration-300 font-medium py-3 px-4 rounded-lg"
              >
                <FaGithub className="text-xl" />
                <span>Login with GitHub</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default GitHubAuth;

src/screenshot/ScreenshotPage.tsx:
// src/screenshot/ScreenshotPage.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Spin, Image, message, Divider } from "antd";
import { useBoolean } from "ahooks";

// Tauri API and Plugins
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  getScreenshotableMonitors,
  getMonitorScreenshot,
  ScreenshotableMonitor,
} from "tauri-plugin-screenshots-api";
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
  checkScreenRecordingPermission,
  requestScreenRecordingPermission,
} from "tauri-plugin-macos-permissions-api";
import {
  register,
  unregister,
  isRegistered,
} from "@tauri-apps/plugin-global-shortcut"; // Import isRegistered

const SCREENSHOT_HOTKEY = "CmdOrCtrl+Shift+S";
// 添加防抖时间常量
const MESSAGE_DEBOUNCE_MS = 300;

type ScreenshotHandler = (source: "button" | "hotkey") => Promise<void>;

function ScreenshotPage() {
  const navigate = useNavigate();

  // Refs
  const didLogHotkeyActive = useRef(false);
  const latestHandleTakeScreenshot = useRef<ScreenshotHandler>(async () => {});
  const isProcessingHotkey = useRef(false);
  const activeMsgTimeoutIdRef = useRef<NodeJS.Timeout | null>(null);
  const didShowRegistrationErrorRef = useRef(false);
  // --- NEW Ref to indicate if registration is currently in progress ---
  const isRegisteringRef = useRef(false);
  // --- NEW Ref for message debounce ---
  const lastMessageTimestampRef = useRef<number>(0);

  // --- State ---
  const [hasAccessibility, setHasAccessibility] = useState<boolean | null>(
    null
  );
  const [hasScreenRecording, setHasScreenRecording] = useState<boolean | null>(
    null
  );
  const [
    isCheckingPermissions,
    { setTrue: startChecking, setFalse: stopChecking },
  ] = useBoolean(false);
  const [isRequestingAccessibility, setIsRequestingAccessibility] =
    useState(false);
  const [isRequestingScreenRecording, setIsRequestingScreenRecording] =
    useState(false);
  const [
    isTakingScreenshot,
    { setTrue: startScreenshot, setFalse: stopScreenshot },
  ] = useBoolean(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [monitors, setMonitors] = useState<ScreenshotableMonitor[]>([]);
  const [error, setError] = useState<string | null>(null);

  // --- Functions ---
  const fetchMonitors = useCallback(async () => {
    // ... (Function remains the same)
    console.log("[Fn] Fetching monitors...");
    try {
      const fetchedMonitors = await getScreenshotableMonitors();
      setMonitors(fetchedMonitors);
      console.log("[Fn] Monitors fetched:", fetchedMonitors.length);
    } catch (err) {
      console.error("[Fn] Error fetching monitors:", err);
      setError(
        (prev) => (prev ? prev + "\n" : "") + `Monitor fetch failed: ${err}`
      );
      setMonitors([]);
    }
  }, []);

  const checkPermissions = useCallback(
    async (showLoading = false) => {
      // ... (Function remains the same)
      console.log("[Fn] Checking permissions...");
      setError(null);
      if (showLoading) startChecking();
      let screenGranted: boolean | null = null;
      let accessibilityGranted: boolean | null = null;
      try {
        console.log("[Fn] Checking Accessibility...");
        accessibilityGranted = await checkAccessibilityPermission();
        setHasAccessibility(accessibilityGranted);

        console.log("[Fn] Checking Screen Recording...");
        screenGranted = await checkScreenRecordingPermission();
        setHasScreenRecording(screenGranted);

        console.log(
          `[Fn] Permissions Checked: Accessibility=${accessibilityGranted}, Screen=${screenGranted}`
        );

        if (screenGranted) {
          console.log("[Fn] Screen permission granted, fetching monitors...");
          await fetchMonitors();
        } else {
          console.log("[Fn] Screen permission not granted, clearing monitors.");
          setMonitors([]);
        }
      } catch (err) {
        console.error("[Fn] Permission check failed:", err);
        setError(
          (prev) =>
            (prev ? prev + "\n" : "") + `Permission check failed: ${err}`
        );
        setHasAccessibility(false);
        setHasScreenRecording(false);
        setMonitors([]);
      } finally {
        if (showLoading) stopChecking();
        console.log("[Fn] Permission check finished.");
      }
    },
    [startChecking, stopChecking, fetchMonitors]
  );

  useEffect(() => {
    // ... (Initial permission check effect remains the same)
    console.log("[Effect] Initial permission check effect runs.");
    checkPermissions(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkPermissions]);

  const handleRequestAccessibility = useCallback(async () => {
    // ... (Function remains the same)
    if (hasAccessibility === true) return;
    console.log("[Fn] Requesting Accessibility permission...");
    setIsRequestingAccessibility(true);
    try {
      await requestAccessibilityPermission();
      const granted = await checkAccessibilityPermission();
      setHasAccessibility(granted);
      console.log("[Fn] Accessibility request result:", granted);
      message[granted ? "success" : "warning"](
        granted ? "Accessibility granted!" : "Accessibility needed."
      );
    } catch (err) {
      console.error("[Fn] Accessibility request failed:", err);
      message.error(`Accessibility request failed: ${err}`);
    } finally {
      setIsRequestingAccessibility(false);
    }
  }, [hasAccessibility]);

  const handleRequestScreenRecording = useCallback(async () => {
    // ... (Function remains the same)
    if (hasScreenRecording === true) return;
    console.log("[Fn] Requesting Screen Recording permission...");
    setIsRequestingScreenRecording(true);
    try {
      await requestScreenRecordingPermission();
      const granted = await checkScreenRecordingPermission();
      setHasScreenRecording(granted);
      console.log("[Fn] Screen Recording request result:", granted);
      if (granted) {
        message.success("Screen Recording granted!");
        await fetchMonitors();
      } else {
        message.warning("Screen Recording needed.");
        setMonitors([]);
      }
    } catch (err) {
      console.error("[Fn] Screen Recording request failed:", err);
      message.error(`Screen Recording request failed: ${err}`);
    } finally {
      setIsRequestingScreenRecording(false);
    }
  }, [hasScreenRecording, fetchMonitors]);

  const handleTakeScreenshot = useCallback(
    async (source: "button" | "hotkey" = "button") => {
      console.log(`[Fn] handleTakeScreenshot triggered by: ${source}`);
      if (isTakingScreenshot) {
        console.warn(
          `[Fn] Screenshot action (${source}) ignored: isTakingScreenshot state is true.`
        );
        return;
      }
      let currentScreenPermission: boolean;
      try {
        console.log("[Fn] Checking screen permission before screenshot...");
        currentScreenPermission = await checkScreenRecordingPermission();
        console.log("[Fn] Screen permission status:", currentScreenPermission);
      } catch (permError) {
        console.error(
          "[Fn] Permission check failed before screenshot:",
          permError
        );
        message.error("Permission check failed before screenshot.");
        return;
      }

      if (!currentScreenPermission) {
        setHasScreenRecording(false);
        console.warn("[Fn] Screen recording permission required.");
        message.error(
          "Screen recording permission required to take screenshot."
        );
        return;
      }
      if (!hasScreenRecording) setHasScreenRecording(true);

      let currentMonitors = monitors;
      if (currentMonitors.length === 0) {
        console.log("[Fn] No monitors in state, attempting fetch...");
        try {
          let attempt = 0;
          while (currentMonitors.length === 0 && attempt < 2) {
            attempt++;
            console.log(`[Fn] Fetch attempt ${attempt}...`);
            currentMonitors = await getScreenshotableMonitors();
          }

          if (currentMonitors.length === 0) {
            console.error("[Fn] No monitors detected even after re-fetching.");
            message.error("No monitors detected even after re-fetching.");
            return;
          }
          console.log(
            "[Fn] Monitors fetched successfully before screenshot:",
            currentMonitors.length
          );
          setMonitors(currentMonitors);
        } catch (fetchErr) {
          console.error(
            "[Fn] Failed to fetch monitors before screenshot:",
            fetchErr
          );
          message.error(
            `Failed to fetch monitors before screenshot: ${fetchErr}`
          );
          return;
        }
      }

      const primaryMonitor = currentMonitors[0];
      if (!primaryMonitor) {
        console.error("[Fn] Primary monitor not found.");
        message.error("Primary monitor not found in the available list.");
        return;
      }

      console.log(
        `[Fn] Attempting screenshot (${source}) on monitor: ${primaryMonitor.name}`
      );
      startScreenshot();
      setScreenshotUrl(null);

      try {
        const filePath = await getMonitorScreenshot(primaryMonitor.id);
        console.log("[Fn] Screenshot captured to path:", filePath);
        const assetUrl = convertFileSrc(filePath);
        console.log("[Fn] Converted file src:", assetUrl);
        const finalUrl = `${assetUrl}?t=${Date.now()}`;
        setScreenshotUrl(finalUrl);

        // 添加消息防抖逻辑
        const now = Date.now();
        if (now - lastMessageTimestampRef.current > MESSAGE_DEBOUNCE_MS) {
          message.success(`Screenshot captured! (${source})`);
          lastMessageTimestampRef.current = now;
          console.log(`[Fn] Screenshot success message shown for ${source}.`);
        } else {
          console.log(
            `[Fn] Skipping duplicate success message (${source}) due to debounce.`
          );
        }
      } catch (err) {
        const errorMsg = `Screenshot Failed (${source}): ${
          err instanceof Error ? err.message : String(err)
        }`;
        console.error("[Fn]", errorMsg, err);
        setError((prev) => (prev ? prev + "\n" : "") + errorMsg);
        message.error("Screenshot failed.");
        setScreenshotUrl(null);
      } finally {
        stopScreenshot();
        console.log(`[Fn] Screenshot process finished for ${source}.`);
      }
    },
    [
      isTakingScreenshot,
      monitors,
      hasScreenRecording,
      fetchMonitors,
      startScreenshot,
      stopScreenshot,
    ]
  );

  useEffect(() => {
    // ... (Effect to update latestHandleTakeScreenshot ref remains the same)
    console.log("[Effect] Updating latestHandleTakeScreenshot ref.");
    latestHandleTakeScreenshot.current = handleTakeScreenshot;
  }, [handleTakeScreenshot]);

  // Register and Unregister Global Hotkey Effect
  useEffect(() => {
    console.log("[Effect] Hotkey registration effect runs (mount/remount).");
    let isHotkeyCurrentlyRegisteredInThisEffect = false; // Track registration state *within this effect run*

    const hotkeyCallback = () => {
      if (isProcessingHotkey.current) {
        console.warn(
          `[Hotkey Callback] Ignored: Already processing previous hotkey press.`
        );
        return;
      }
      try {
        isProcessingHotkey.current = true;
        console.log(
          `[Hotkey Callback] ${SCREENSHOT_HOTKEY} pressed, lock acquired.`
        );
        latestHandleTakeScreenshot
          .current("hotkey")
          .catch((handlerError) => {
            console.error(
              "[Hotkey Callback] Error during handleTakeScreenshot execution:",
              handlerError
            );
          })
          .finally(() => {
            isProcessingHotkey.current = false;
            console.log(
              "[Hotkey Callback] Processing finished, lock released."
            );
          });
      } catch (error) {
        console.error("[Hotkey Callback] Unexpected synchronous error:", error);
        isProcessingHotkey.current = false;
      }
    };

    const manageHotkeyRegistration = async () => {
      // Prevent concurrent registration attempts (e.g., from rapid StrictMode runs)
      if (isRegisteringRef.current) {
        console.log(
          "[Effect] Registration already in progress, skipping this attempt."
        );
        return;
      }
      isRegisteringRef.current = true;
      console.log("[Effect] Starting hotkey registration management.");

      // Clear any pending "active" message from previous attempts
      if (activeMsgTimeoutIdRef.current) {
        clearTimeout(activeMsgTimeoutIdRef.current);
        activeMsgTimeoutIdRef.current = null;
      }

      // --- **Defensive Unregister** ---
      try {
        // Check if it *thinks* it's registered before trying to unregister
        // This reduces unnecessary calls when we know it shouldn't be registered
        const potentiallyRegistered = await isRegistered(SCREENSHOT_HOTKEY);
        if (potentiallyRegistered) {
          console.log(
            `[Effect] Attempting defensive unregister for ${SCREENSHOT_HOTKEY} as it might be lingering...`
          );
          await unregister(SCREENSHOT_HOTKEY);
          console.log(`[Effect] Defensive unregister successful.`);
        } else {
          console.log(
            `[Effect] Skipping defensive unregister: ${SCREENSHOT_HOTKEY} is not currently registered.`
          );
        }
      } catch (err: any) {
        // Log unexpected errors during the defensive unregister attempt
        console.warn(
          `[Effect] Error during defensive unregister/check (but proceeding):`,
          err
        );
      }
      // --- **End Defensive Unregister** ---

      // --- **Attempt Registration** ---
      try {
        console.log(
          `[Effect] Attempting to register hotkey: ${SCREENSHOT_HOTKEY}`
        );
        await register(SCREENSHOT_HOTKEY, hotkeyCallback);
        isHotkeyCurrentlyRegisteredInThisEffect = true; // Mark success *for this effect's cleanup*
        console.log(
          `[Effect] Hotkey ${SCREENSHOT_HOTKEY} registered successfully.`
        );

        // Schedule "active" message (if not shown before in lifecycle)
        if (!didLogHotkeyActive.current) {
          console.log("[Effect] Scheduling hotkey active message...");
          activeMsgTimeoutIdRef.current = setTimeout(() => {
            console.log("[Effect] Showing delayed hotkey active message.");
            message.info(`Screenshot hotkey (${SCREENSHOT_HOTKEY}) active.`, 2);
            didLogHotkeyActive.current = true;
            activeMsgTimeoutIdRef.current = null;
          }, 100);
        }
      } catch (err) {
        console.error(
          `[Effect] Failed to register hotkey ${SCREENSHOT_HOTKEY}:`,
          err
        );
        isHotkeyCurrentlyRegisteredInThisEffect = false; // Mark failure

        // Cancel pending "active" message
        if (activeMsgTimeoutIdRef.current) {
          clearTimeout(activeMsgTimeoutIdRef.current);
          activeMsgTimeoutIdRef.current = null;
        }

        // Show error message (once per mount cycle)
        if (!didShowRegistrationErrorRef.current) {
          message.error(`Hotkey ${SCREENSHOT_HOTKEY} may be in use.`);
          didShowRegistrationErrorRef.current = true;
        } else {
          console.warn(
            `[Effect] Suppressed duplicate registration error message for ${SCREENSHOT_HOTKEY}.`
          );
        }
      } finally {
        // --- Release registration lock ---
        isRegisteringRef.current = false;
        console.log("[Effect] Hotkey registration management finished.");
      }
    };

    manageHotkeyRegistration();

    // Cleanup Function
    return () => {
      console.log("[Effect Cleanup] Hotkey registration effect cleanup START.");

      // Clear pending "active" message
      if (activeMsgTimeoutIdRef.current) {
        clearTimeout(activeMsgTimeoutIdRef.current);
        activeMsgTimeoutIdRef.current = null;
        console.log("[Effect Cleanup] Cleared pending active message.");
      }

      // Unregister *only if this specific effect run successfully registered it*
      if (isHotkeyCurrentlyRegisteredInThisEffect) {
        console.log(
          `[Effect Cleanup] Attempting to unregister ${SCREENSHOT_HOTKEY} (registered by this effect instance).`
        );
        // We use a separate async function for unregister logic if needed complex handling,
        // but fire-and-forget is common in cleanup. Adding check before unregister.
        const unregisterTask = async () => {
          try {
            if (await isRegistered(SCREENSHOT_HOTKEY)) {
              await unregister(SCREENSHOT_HOTKEY);
              console.log(
                `[Effect Cleanup] Unregister command for ${SCREENSHOT_HOTKEY} sent successfully.`
              );
            } else {
              console.log(
                `[Effect Cleanup] Unregister skipped: ${SCREENSHOT_HOTKEY} was already unregistered.`
              );
            }
          } catch (err) {
            console.error(
              `[Effect Cleanup] Failed to unregister ${SCREENSHOT_HOTKEY}:`,
              err
            );
          } finally {
            // Resetting isProcessingHotkey here might be too early if unregister is truly async
            // Let the unmount effect handle it.
          }
        };
        unregisterTask(); // Fire off the unregister task
      } else {
        console.log(
          `[Effect Cleanup] Skipping unregister: Hotkey was not registered by this specific effect instance.`
        );
      }
      console.log("[Effect Cleanup] Hotkey registration effect cleanup END.");
    };
  }, []); // Empty dependency array

  // Effect to Reset Flags on TRUE Unmount
  useEffect(() => {
    return () => {
      console.log(
        "[Effect Cleanup] Component truly unmounting. Resetting flags and ensuring unregistration."
      );
      // Reset flags
      didLogHotkeyActive.current = false;
      didShowRegistrationErrorRef.current = false;
      isProcessingHotkey.current = false; // Reset hotkey lock
      isRegisteringRef.current = false; // Reset registration lock
      // 重置消息防抖时间戳
      lastMessageTimestampRef.current = 0;

      // Clear any lingering timeout
      if (activeMsgTimeoutIdRef.current) {
        clearTimeout(activeMsgTimeoutIdRef.current);
        activeMsgTimeoutIdRef.current = null;
      }

      // --- **Final Unregistration Attempt** ---
      // This acts as a final safeguard on true unmount, regardless of
      // the state of isHotkeyCurrentlyRegisteredInThisEffect from the other effect.
      console.log(
        `[Effect Cleanup] Performing final unregistration check/attempt for ${SCREENSHOT_HOTKEY} on true unmount.`
      );
      const finalUnregister = async () => {
        try {
          if (await isRegistered(SCREENSHOT_HOTKEY)) {
            await unregister(SCREENSHOT_HOTKEY);
            console.log(`[Effect Cleanup] Final unregister successful.`);
          } else {
            console.log(
              `[Effect Cleanup] Final unregister unnecessary: not registered.`
            );
          }
        } catch (err) {
          console.error(
            `[Effect Cleanup] Error during final unregister attempt:`,
            err
          );
        }
      };
      finalUnregister(); // Fire and forget final attempt
    };
  }, []); // Empty dependency array ensures cleanup runs only on true unmount

  // --- Helper ---
  const getStatusText = (status: boolean | null): string => {
    if (status === null) return "Checking...";
    return status ? "Granted ✅" : "Not Granted ❌";
  };

  // --- Render ---
  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      {/* ... (rest of the JSX remains the same) ... */}
      {isCheckingPermissions && (
        <Spin style={{ position: "absolute", top: "10px", right: "10px" }} />
      )}
      <h1>Screen Permissions & Screenshot (macOS)</h1>
      <p>
        Press <strong>{SCREENSHOT_HOTKEY}</strong> or click the button below.
      </p>
      {error && (
        <pre
          style={{
            color: "red",
            border: "1px solid red",
            padding: "10px",
            whiteSpace: "pre-wrap",
            marginBottom: "15px",
            maxHeight: "150px",
            overflowY: "auto",
          }}
        >
          Errors Encountered:{"\n"}
          {error}
        </pre>
      )}

      {/* Permission Sections */}
      <div
        style={{
          marginBottom: "20px",
          padding: "15px",
          border: "1px solid #eee",
          borderRadius: "5px",
        }}
      >
        <h2>Accessibility Permission</h2>
        <p>
          Status: <strong>{getStatusText(hasAccessibility)}</strong>
        </p>
        <Button
          onClick={handleRequestAccessibility}
          disabled={hasAccessibility === true || isRequestingAccessibility}
          loading={isRequestingAccessibility}
        >
          {hasAccessibility ? "Granted" : "Request"}
        </Button>
      </div>
      <div
        style={{
          marginBottom: "20px",
          padding: "15px",
          border: "1px solid #eee",
          borderRadius: "5px",
        }}
      >
        <h2>Screen Recording Permission</h2>
        <p>
          Status: <strong>{getStatusText(hasScreenRecording)}</strong>
        </p>
        <Button
          onClick={handleRequestScreenRecording}
          disabled={hasScreenRecording === true || isRequestingScreenRecording}
          loading={isRequestingScreenRecording}
        >
          {hasScreenRecording ? "Granted" : "Request"}
        </Button>
      </div>

      <Divider />

      {/* Screenshot Section */}
      <h2>Take Screenshot</h2>
      <div
        style={{
          marginBottom: "20px",
          padding: "15px",
          border: "1px solid #eee",
          borderRadius: "5px",
        }}
      >
        <Button
          type="primary"
          onClick={() => handleTakeScreenshot("button")}
          disabled={!hasScreenRecording || isTakingScreenshot}
          loading={isTakingScreenshot}
          style={{ marginRight: "10px" }}
        >
          {isTakingScreenshot
            ? "Capturing..."
            : `Capture ${
                monitors.length > 0 ? monitors[0]?.name : "Primary Monitor"
              }`}
        </Button>
        {!hasScreenRecording && (
          <span style={{ color: "orange", marginLeft: "10px" }}>
            Requires Screen Recording permission.
          </span>
        )}
        {hasScreenRecording === true &&
          monitors.length === 0 &&
          !isCheckingPermissions &&
          !isTakingScreenshot && (
            <span style={{ color: "orange", marginLeft: "10px" }}>
              Could not detect monitors initially. Try refreshing or check
              system settings.
            </span>
          )}
        {screenshotUrl && (
          <div style={{ marginTop: "15px" }}>
            <h3>Screenshot Preview:</h3>
            <Image
              key={screenshotUrl}
              width={300}
              src={screenshotUrl}
              alt="Screenshot Preview"
              placeholder={<Spin tip="Loading Preview..." size="large" />}
              style={{ border: "1px solid #ccc", maxWidth: "100%" }}
              preview={true}
            />
          </div>
        )}
        {isTakingScreenshot && !screenshotUrl && (
          <div style={{ marginTop: "15px" }}>
            <Spin /> Capturing...
          </div>
        )}
      </div>

      <Divider />

      {/* Actions */}
      <Button
        onClick={() => checkPermissions(true)}
        disabled={isCheckingPermissions}
        style={{ marginRight: "10px" }}
      >
        Refresh Permissions
      </Button>
      <Button onClick={() => navigate(-1)}>Back</Button>
    </div>
  );
}

export default ScreenshotPage;

src/screenshot/query.tsx:
import React, { useState, useCallback } from "react";
// 导入刚才创建的 CSS 文件
import "./query.css";
// 导入 Tauri API (如果需要与后端交互，暂时注释掉)
// import { invoke } from '@tauri-apps/api/core'; // Tauri v2
// import { getCurrent } from '@tauri-apps/api/window'; // 用于获取当前窗口

const QueryComponent: React.FC = () => {
  // 使用 useState 来管理输入框的值
  const [inputValue, setInputValue] = useState<string>("");
  // 使用 useState 来显示一些反馈信息
  const [feedback, setFeedback] = useState<string>("");

  // 处理输入框内容变化
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
    // 输入时清除反馈信息
    if (feedback) {
      setFeedback("");
    }
  };

  // 处理按钮点击事件
  const handleSearchClick = useCallback(async () => {
    if (!inputValue.trim()) {
      setFeedback("Please enter something to search.");
      return;
    }

    setFeedback(`Searching for: "${inputValue}"...`);
    console.log("Search initiated for:", inputValue);

    // --- 在这里添加与 Tauri 后端交互的逻辑 ---
    try {
      // 示例：调用一个名为 'perform_screenshot_search' 的后端命令
      // const results = await invoke<string[]>('perform_screenshot_search', { query: inputValue });
      // console.log('Search results:', results);
      // setFeedback(`Found ${results.length} results.`);

      // 模拟一个延迟，假装在搜索
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setFeedback(`Search complete for: "${inputValue}" (Placeholder)`);

      // 可选：操作当前窗口，例如搜索完成后关闭
      // const appWindow = await getCurrent();
      // await appWindow.close();
    } catch (error) {
      console.error("Error during search:", error);
      setFeedback(`Error searching: ${error}`);
    }
    // ------------------------------------------
  }, [inputValue]); // 依赖 inputValue，当它变化时重新创建回调

  // 处理在输入框按 Enter 键
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      handleSearchClick();
    }
  };

  return (
    <div className="query-container">
      <h1 className="query-title">Screenshot Query</h1>
      <input
        type="text"
        className="query-input"
        placeholder="Enter search term..."
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown} // 添加键盘事件监听
        autoFocus // 窗口打开时自动聚焦输入框
      />
      <button className="query-button" onClick={handleSearchClick}>
        Search
      </button>
      {/* 显示反馈信息 */}
      {feedback && <p className="query-feedback">{feedback}</p>}
    </div>
  );
};

export default QueryComponent;

src/store/authStore.ts:
// src/store/authStore.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// --- 复用或重新定义类型 ---
type AuthStatus = "idle" | "loading" | "success" | "error";

interface GitHubProfile {
  login: string;
  id: number;
  name?: string;
  avatar_url: string;
  email?: string;
}

interface AuthStoreState {
  authState: AuthStatus;
  userProfile: GitHubProfile | null;
  authError: string | null;
}

interface AuthStoreActions {
  setAuthState: (status: AuthStatus) => void;
  setUserProfile: (profile: GitHubProfile | null) => void;
  setAuthError: (error: string | null) => void;
  loginStart: () => void;
  loginSuccess: (profile: GitHubProfile) => void;
  loginFailure: (error: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStoreState & AuthStoreActions>()(
  persist(
    (set) => ({
      // ... (State and Actions remain the same) ...
      // --- 初始状态 ---
      authState: "idle",
      userProfile: null,
      authError: null,

      // --- 实现 Actions ---
      setAuthState: (status) => set({ authState: status }),
      setUserProfile: (profile) => set({ userProfile: profile }),
      setAuthError: (error) => set({ authError: error }),

      // 组合 Action：开始登录
      loginStart: () =>
        set({
          authState: "loading",
          userProfile: null, // 清除旧的用户信息
          authError: null, // 清除旧的错误
        }),

      // 组合 Action：登录成功
      loginSuccess: (profile) =>
        set({
          authState: "success",
          userProfile: profile,
          authError: null,
        }),

      // 组合 Action：登录失败
      loginFailure: (error) =>
        set({
          authState: "error",
          userProfile: null, // 确保没有用户信息
          authError: error,
        }),

      // 组合 Action：登出
      logout: () =>
        set({
          authState: "idle",
          userProfile: null,
          authError: null,
        }),
    }),
    {
      // --- Persistence Configuration ---
      name: "github-auth-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        authState: state.authState,
        userProfile: state.userProfile,
      }),

      // --- Corrected onRehydrateStorage ---
      // 将 state 参数重命名为 _state
      onRehydrateStorage: (_state) => {
        // This outer function is called BEFORE rehydration.
        // (_state is the state before rehydration, not used here)
        console.log("Starting rehydration process for auth store...");

        // Return the inner function to be called AFTER rehydration.
        return (rehydratedState, error) => {
          if (error) {
            console.error(
              "An error occurred during auth store rehydration:",
              error
            );
            useAuthStore.getState().logout(); // Call action directly on store
          } else {
            console.log("Auth store rehydration finished.");
            if (rehydratedState) {
              if (
                rehydratedState.authState === "success" &&
                !rehydratedState.userProfile
              ) {
                console.warn(
                  "Rehydrated as 'success' but no user profile found. Resetting state using logout action."
                );
                useAuthStore.getState().logout();
              }
            }
          }
        }; // End of inner function
      }, // End of onRehydrateStorage
    } // End of persist options
  ) // End of persist middleware
); // End of create

// (可选) 导出类型供外部使用
export type { AuthStatus, GitHubProfile };

```

```tauri(rust backend)
src-tauri/src/auth.rs:
// src-tauri/src/auth.rs
// --- Dependencies ---
use once_cell::sync::Lazy; // For lazy static initialization
use rand::distr::Alphanumeric;
use rand::{thread_rng, Rng};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex}; // Use StdMutex for PendingAuthState
use tauri::{AppHandle, Emitter, Manager, Runtime, State}; // Ensure Manager is imported
use thiserror::Error;
use tokio::sync::{oneshot, Mutex as TokioMutex}; // TokioMutex for async server state
use urlencoding; // For URL encoding parameters

// --- Conditional Imports for Dev Server ---
#[cfg(debug_assertions)]
use axum::{
    extract::{Query, State as AxumState},
    http,
    response::Html,
    routing::get,
    Router,
};
#[cfg(debug_assertions)]
use std::net::SocketAddr;

// --- Configuration Structure ---
#[derive(Clone, Debug)]
struct EnvConfig {
    github_client_id: String,
    github_client_secret: String,
    worker_api_url: String,
    worker_api_key: String,
}

// --- Compile-time Embedding and Lazy Parsing (with detailed logging) ---
// Reads the appropriate .env file *at compile time* using include_str!
// Parses the content *once* at runtime when first accessed.
// WARNING: This embeds secrets directly into the binary.
static CONFIG: Lazy<EnvConfig> = Lazy::new(|| {
    println!("Auth: Initializing embedded configuration...");
    let env_content = if cfg!(debug_assertions) {
        println!("Auth: Embedding .env.development content.");
        include_str!("../../.env.development")
    } else {
        println!("Auth: Embedding .env.production content.");
        include_str!("../../.env.production")
    };

    println!("Auth: Parsing embedded content:\n---\n{}\n---", env_content);
    let mut vars = HashMap::new();
    for (line_num, line) in env_content.lines().enumerate() {
        let trimmed_line = line.trim();
        if trimmed_line.is_empty() || trimmed_line.starts_with('#') {
            continue;
        }
        // Split only on the *first* '='
        if let Some((key, value)) = trimmed_line.split_once('=') {
            let key_trimmed = key.trim();
            // --- START: Modification Area ---
            // OLD LOGIC:
            // let value_trimmed = value.trim();

            // NEW LOGIC (with quote stripping):
            let value_initially_trimmed = value.trim(); // 1. Trim whitespace first
            let final_value = // 2. Check for surrounding quotes and strip if found
                if value_initially_trimmed.starts_with('"') && value_initially_trimmed.ends_with('"') && value_initially_trimmed.len() >= 2 {
                    &value_initially_trimmed[1..value_initially_trimmed.len() - 1] // Strip double quotes
                } else if value_initially_trimmed.starts_with('\'') && value_initially_trimmed.ends_with('\'') && value_initially_trimmed.len() >= 2 {
                    &value_initially_trimmed[1..value_initially_trimmed.len() - 1] // Strip single quotes
                } else {
                    value_initially_trimmed // No surrounding quotes, use the trimmed value
                };
            // --- END: Modification Area ---

            if key_trimmed.is_empty() {
                println!(
                    "Auth: Warning - Parsed empty key in embedded .env line {}: {}",
                    line_num + 1,
                    line
                );
                continue;
            }
            // Use the 'final_value' which might have had quotes stripped
            println!(
                "Auth: Parsed line {}: KEY='{}', VALUE='{}'",
                line_num + 1,
                key_trimmed,
                final_value
            );
            // Insert the potentially modified value into the map
            vars.insert(key_trimmed.to_string(), final_value.to_string()); // Use final_value here
        } else {
            if !trimmed_line.is_empty() {
                println!(
                    "Auth: Warning - Could not parse line {} in embedded .env (missing '='?): {}",
                    line_num + 1,
                    line
                );
            }
        }
    }
    println!(
        "Auth: Finished parsing embedded content. Found {} potential variables.",
        vars.len()
    );

    // --- Extraction logic remains the same, but uses the parsed 'vars' map ---
    let config = EnvConfig {
        github_client_id: {
            println!("Auth: Extracting GITHUB_CLIENT_ID...");
            let key = "GITHUB_CLIENT_ID";
            let val = vars
                .get(key) // Get value from the map we populated
                .unwrap_or_else(|| panic!("Embedded .env file must contain {}", key))
                .clone(); // Clone the String value
            println!("Auth: GITHUB_CLIENT_ID = '{}'", val);
            if val.is_empty() {
                panic!("Embedded GITHUB_CLIENT_ID must not be empty");
            }
            val
        },
        // ... (similar extraction for other keys: GITHUB_CLIENT_SECRET, WORKER_API_URL, WORKER_API_KEY) ...
        github_client_secret: {
            println!("Auth: Extracting GITHUB_CLIENT_SECRET...");
            let key = "GITHUB_CLIENT_SECRET";
            let val = vars
                .get(key)
                .unwrap_or_else(|| panic!("...must contain {}", key))
                .clone();
            let secret_len = val.len();
            let masked_secret = if secret_len > 4 {
                format!("***{}", &val[secret_len - 4..])
            } else {
                "***".to_string()
            };
            println!("Auth: GITHUB_CLIENT_SECRET = '{}'", masked_secret);
            if val.is_empty() {
                panic!("...must not be empty");
            }
            val
        },
        worker_api_url: {
            println!("Auth: Extracting WORKER_API_URL...");
            let key = "WORKER_API_URL";
            let val = vars
                .get(key)
                .unwrap_or_else(|| panic!("...must contain {}", key))
                .clone();
            println!("Auth: WORKER_API_URL = '{}'", val);
            if val.is_empty() {
                panic!("...must not be empty");
            }
            val
        },
        worker_api_key: {
            println!("Auth: Extracting WORKER_API_KEY...");
            let key = "WORKER_API_KEY";
            let val = vars
                .get(key)
                .unwrap_or_else(|| panic!("...must contain {}", key))
                .clone();
            let key_len = val.len();
            let masked_key = if key_len > 4 {
                format!("***{}", &val[key_len - 4..])
            } else {
                "***".to_string()
            };
            println!("Auth: WORKER_API_KEY = '{}'", masked_key);
            if val.is_empty() {
                panic!("...must not be empty");
            }
            val
        },
    };
    println!("Auth: Embedded configuration initialized successfully.");
    config
});

// --- Accessor functions for embedded config ---
// These provide clean access to the lazily initialized static CONFIG
fn get_github_client_id() -> &'static str {
    &CONFIG.github_client_id
}

fn get_github_client_secret() -> &'static str {
    &CONFIG.github_client_secret
}

fn get_worker_api_url() -> &'static str {
    &CONFIG.worker_api_url
}

fn get_worker_api_key() -> &'static str {
    &CONFIG.worker_api_key
}

// --- Dynamic Redirect URI based on build type (remains the same) ---
fn get_redirect_uri() -> &'static str {
    if cfg!(debug_assertions) {
        "http://127.0.0.1:54321/callback" // Development: Local server
    } else {
        "revision://github/callback" // Production: Use YOUR custom scheme "revision"
    }
}

const CSRF_STATE_EXPIRY_SECS: u64 = 300; // 5 minutes

// --- State Management ---
// Shared state for pending requests (used by both dev server and deep link handler)
pub type PendingAuthState =
    Arc<StdMutex<HashMap<String, oneshot::Sender<Result<String, AuthError>>>>>;

// --- Dev Server Specific State ---
#[cfg(debug_assertions)]
#[derive(Default)]
pub struct ServerHandle {
    pub shutdown_tx: Option<oneshot::Sender<()>>,
    pub join_handle: Option<tokio::task::JoinHandle<()>>,
}
#[cfg(debug_assertions)]
pub type AuthServerState = Arc<TokioMutex<ServerHandle>>; // TokioMutex needed for async locking around start/stop

// --- Data Structures ---
#[derive(Deserialize, Debug)]
struct CallbackParams {
    code: String,
    state: String,
}

#[derive(Deserialize, Debug)]
struct GithubTokenResponse {
    access_token: String,
    // scope: String, // Often included, keep if needed
    // token_type: String, // Often included, keep if needed
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GithubUserProfile {
    login: String,
    id: u64,
    name: Option<String>,
    avatar_url: String,
    email: Option<String>, // Make sure 'user:email' scope is requested
}

#[derive(Serialize, Debug)]
struct BackendSyncPayload<'a> {
    profile: &'a GithubUserProfile,
}

#[derive(Deserialize, Debug)]
struct BackendSyncResponse {
    success: bool,
    message: Option<String>,
}

// --- Error Handling ---
#[derive(Serialize, Debug, Clone, Error)]
pub enum AuthError {
    #[error("Network request failed: {0}")]
    ReqwestError(String),
    #[cfg(debug_assertions)]
    #[error("Failed to start local callback server: {0}")]
    ServerStartError(String),
    #[error("Invalid CSRF state received")]
    InvalidState,
    #[error("GitHub returned an error: {0}")]
    GitHubError(String),
    #[error("Callback timed out or was cancelled")]
    CallbackTimeout,
    #[error("Failed to parse response: {0}")]
    ParseError(String),
    #[error("Internal error: {0}")]
    InternalError(String),
    #[error("Authentication cancelled by user or system")]
    Cancelled,
    #[error("Failed to sync user data to backend: {0}")]
    BackendSyncFailed(String),
    #[error("Deep link error: {0}")]
    DeepLinkError(String),
    // Added specific error for config issues if needed, though panic is current behavior
    // #[error("Configuration error: {0}")]
    // ConfigError(String),
}

// Convert reqwest errors
impl From<reqwest::Error> for AuthError {
    fn from(err: reqwest::Error) -> Self {
        AuthError::ReqwestError(err.to_string())
    }
}

// --- Tauri Command ---
#[tauri::command]
pub async fn login_with_github<R: Runtime>(
    app: AppHandle<R>,
    pending_auth_state: State<'_, PendingAuthState>,
) -> Result<String, String> {
    // Returns GitHub Auth URL or an error string
    println!("Auth: Initiating GitHub OAuth flow...");

    // --- Determine Redirect URI ---
    let redirect_uri = get_redirect_uri();
    println!("Auth: Using redirect URI: {}", redirect_uri);

    // --- Get Client ID and Log It Carefully ---
    // Access the embedded config via the accessor function.
    // This triggers the Lazy initialization on the first call.
    let github_client_id = get_github_client_id();
    // Log the raw ID value obtained from config to verify it's correct and not empty.
    println!("Auth: Using Client ID from config: '{}'", github_client_id);
    // Ensure client_id is not empty after retrieval, otherwise the URL will be invalid.
    if github_client_id.is_empty() {
        let err_msg = "Fatal: Embedded GITHUB_CLIENT_ID is empty after initialization.".to_string();
        eprintln!("Auth: {}", err_msg);
        // Optionally emit an error event
        let _ = app.emit(
            "github_auth_error",
            Some(AuthError::InternalError(err_msg.clone())),
        );
        return Err(err_msg); // Return error to frontend
    }

    // --- State and Channel Setup ---
    let state: String = thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32) // Generate a random state string
        .map(char::from)
        .collect();
    let (code_tx, code_rx) = oneshot::channel::<Result<String, AuthError>>();

    // --- Conditional: Start Dev Server ---
    #[cfg(debug_assertions)]
    {
        if let Some(server_state) = app.try_state::<AuthServerState>() {
            println!("Auth [Debug]: Attempting to start local callback server...");
            let server_start_result = start_dev_server(
                app.clone(),
                pending_auth_state.inner().clone(), // Pass Arc<StdMutex<...>>
                server_state.inner().clone(),       // Pass Arc<TokioMutex<...>>
            )
            .await;

            if let Err(e) = server_start_result {
                eprintln!("Auth [Debug]: Failed to start server: {:?}", e);
                let _ = app.emit("github_auth_error", Some(e.clone())); // Emit specific error
                return Err(e.to_string()); // Return error to frontend invoke
            }
            println!("Auth [Debug]: Local callback server running or already started.");
        } else {
            let err =
                AuthError::InternalError("AuthServerState not managed in debug build".to_string());
            eprintln!("Auth [Debug]: Error - {}", err);
            let _ = app.emit("github_auth_error", Some(err.clone()));
            return Err(err.to_string());
        }
    } // End #[cfg(debug_assertions)] block for starting server

    // --- Store state and sender *before* returning URL ---
    {
        let mut pending_map = pending_auth_state
            .lock()
            .expect("Failed to lock pending auth state");
        pending_map.insert(state.clone(), code_tx);
        println!(
            "Auth: State '{}' stored. Ready for callback/deep link.",
            state
        );
    }

    // --- Encode parameters needed for the URL ---
    // Encode redirect_uri
    let encoded_redirect_uri = urlencoding::encode(redirect_uri);
    println!("Auth: Encoded Redirect URI: {}", encoded_redirect_uri);

    // Encode scope
    let scope = "read:user user:email"; // Request basic profile and email access
    let encoded_scope = urlencoding::encode(scope);
    println!("Auth: Encoded Scope: {}", encoded_scope);

    // State usually doesn't *need* encoding unless it contains special URL characters,
    // but it's safer if you expect unusual state values. Standard Alphanumeric is fine.
    // let encoded_state = urlencoding::encode(&state);

    // --- Build GitHub Authorization URL ---
    let auth_url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope={}&state={}",
        github_client_id,     // Use the validated, non-empty client_id
        encoded_redirect_uri, // Use encoded redirect URI
        encoded_scope,        // Use encoded scope
        state.clone()         // Use the original state string
    );

    // --- !!! PRINT THE FINAL URL FOR DEBUGGING !!! ---
    println!("Auth: Generated Auth URL to open: {}", auth_url);

    // --- Spawn the Task to Wait for Callback/Deep Link and Handle Flow ---
    let task_app_handle = app.clone();
    let task_pending_auth_state = pending_auth_state.inner().clone();
    let task_state = state.clone(); // Clone state for the task

    tokio::spawn(async move {
        // This is the "Authentication Processing Task"
        println!(
            "Auth Task [{}]: Spawned. Waiting for callback/deep link...",
            task_state
        );

        // --- Wait for callback/deep link or timeout ---
        let code_result = match tokio::time::timeout(
            std::time::Duration::from_secs(CSRF_STATE_EXPIRY_SECS),
            code_rx, // Wait on the receiver end of the oneshot channel
        )
        .await
        {
            Ok(Ok(code_res)) => {
                // Received from channel successfully
                println!("Auth Task [{}]: Code received via channel.", task_state);
                code_res // This is Result<String, AuthError>
            }
            Ok(Err(_rx_err)) => {
                // Channel sender was dropped
                eprintln!(
                    "Auth Task [{}]: Callback/Deep Link sender dropped (state likely removed).",
                    task_state
                );
                Err(AuthError::Cancelled) // Indicate cancellation/interruption
            }
            Err(_timeout_err) => {
                // Timeout waiting for channel
                let removed = task_pending_auth_state
                    .lock()
                    .unwrap()
                    .remove(&task_state)
                    .is_some();
                if removed {
                    println!(
                        "Auth Task [{}]: Timed out waiting for code. State removed.",
                        task_state
                    );
                } else {
                    println!(
                        "Auth Task [{}]: Timed out, but state was already removed.",
                        task_state
                    );
                }
                Err(AuthError::CallbackTimeout)
            }
        };

        // --- Process Result (Exchange code, Get Profile, Sync, Emit events) ---
        let final_result: Result<(), AuthError> = async {
            let code = code_result?; // Propagate error
            println!("Auth Task [{}]: Exchanging code for token...", task_state);
            let token_info = exchange_code_for_token(&code).await?;
            println!("Auth Task [{}]: Fetching GitHub profile...", task_state);
            let profile = fetch_github_user_profile(&token_info.access_token).await?;
            println!(
                "Auth Task [{}]: Profile fetched for '{}'",
                task_state, profile.login
            );
            println!("Auth Task [{}]: Syncing profile to backend...", task_state);
            sync_user_profile_to_backend(&profile).await?;
            println!(
                "Auth Task [{}]: Authentication successful. Emitting event.",
                task_state
            );
            task_app_handle.emit(
                "github_auth_success",
                Some(serde_json::json!({ "profile": profile })),
            ); // Use ? to propagate emit error
            Ok(())
        }
        .await;

        // --- Handle Final Result (Error Emission, State Removal) ---
        if let Err(final_err) = final_result {
            eprintln!(
                "Auth Task [{}]: Authentication flow failed: {:?}",
                task_state, final_err
            );
            match final_err {
                AuthError::CallbackTimeout
                | AuthError::InvalidState
                | AuthError::DeepLinkError(_)
                | AuthError::Cancelled => (), // State handled elsewhere or N/A
                _ => {
                    // Remove state on other errors
                    if task_pending_auth_state
                        .lock()
                        .unwrap()
                        .remove(&task_state)
                        .is_some()
                    {
                        println!(
                            "Auth Task [{}]: State removed due to error: {:?}",
                            task_state, final_err
                        );
                    }
                }
            }
            let _ = task_app_handle.emit("github_auth_error", Some(final_err));
        }

        // --- Conditional: Shutdown Dev Server ---
        #[cfg(debug_assertions)]
        {
            if let Some(task_server_state) = task_app_handle.try_state::<AuthServerState>() {
                println!(
                    "Auth Task [{}]: Requesting dev server shutdown...",
                    task_state
                );
                shutdown_dev_server(task_server_state.inner().clone()).await;
            } else {
                eprintln!(
                    "Auth Task [{}]: Could not get AuthServerState to shut down server.",
                    task_state
                );
            }
        }
        println!("Auth Task [{}]: Finished.", task_state);
    }); // End of tokio::spawn

    // --- Return the Auth URL immediately ---
    println!("Auth: Returning auth URL to frontend.");
    Ok(auth_url) // Return the URL for the frontend to open
}

// --- === DEV SERVER SPECIFIC CODE (Only compiled in debug) === ---

#[cfg(debug_assertions)]
async fn start_dev_server<R: Runtime>(
    app_handle: AppHandle<R>,
    pending_state_clone: PendingAuthState, // Arc<StdMutex<...>>
    server_state_clone: AuthServerState,   // Arc<TokioMutex<...>>
) -> Result<(), AuthError> {
    let mut server_handle_guard = server_state_clone.lock().await; // Lock the server state

    if server_handle_guard.join_handle.is_some() {
        println!("Auth [Debug]: Server already running.");
        return Ok(());
    }

    let addr_str = get_redirect_uri();
    let addr = match addr_str.parse::<http::Uri>() {
        Ok(uri) => {
            let host = uri.host().unwrap_or("127.0.0.1");
            let port = uri.port_u16().unwrap_or(54321);
            let ip = match host.parse::<std::net::IpAddr>() {
                Ok(ip_addr) => ip_addr,
                Err(_) => {
                    if host == "localhost" {
                        [127, 0, 0, 1].into()
                    } else {
                        eprintln!(
                            "Auth [Debug]: Failed to parse host '{}', defaulting to 127.0.0.1",
                            host
                        );
                        [127, 0, 0, 1].into()
                    }
                }
            };
            SocketAddr::new(ip, port)
        }
        Err(_) => {
            eprintln!(
                "Auth [Debug]: Failed to parse redirect URI '{}', defaulting to 127.0.0.1:54321",
                addr_str
            );
            SocketAddr::from(([127, 0, 0, 1], 54321))
        }
    };

    println!("Auth [Debug]: Attempting to bind server to {}", addr);
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            let err_msg = format!("Failed to bind to {}: {}", addr, e);
            eprintln!("Auth [Debug]: {}", err_msg);
            let _ = app_handle.emit(
                "github_auth_error",
                Some(AuthError::ServerStartError(err_msg.clone())),
            );
            return Err(AuthError::ServerStartError(err_msg));
        }
    };

    let (internal_shutdown_tx, internal_shutdown_rx) = oneshot::channel::<()>();

    let app_router = Router::new()
        .route("/callback", get(github_callback_handler))
        .with_state(pending_state_clone); // Share pending state

    let server_config = axum::serve(listener, app_router.into_make_service())
        .with_graceful_shutdown(async {
            internal_shutdown_rx.await.ok();
            println!("Auth [Debug]: Callback server received shutdown signal.");
        });

    println!("Auth [Debug]: Callback server listening on {}", addr);

    let task_server_state_clone = server_state_clone.clone();
    let server_task = tokio::spawn(async move {
        if let Err(e) = server_config.await {
            eprintln!("Auth [Debug]: Server error: {}", e);
        } else {
            println!("Auth [Debug]: Server task finished gracefully.");
        }
        let mut guard = task_server_state_clone.lock().await;
        guard.shutdown_tx = None;
        guard.join_handle = None; // Clear state
        println!("Auth [Debug]: Server handle state cleared.");
    });

    server_handle_guard.shutdown_tx = Some(internal_shutdown_tx);
    server_handle_guard.join_handle = Some(server_task);
    println!("Auth [Debug]: Server started, shutdown sender and join handle stored.");

    Ok(())
}

#[cfg(debug_assertions)]
async fn shutdown_dev_server(server_state: AuthServerState) {
    let server_task_join_handle: Option<tokio::task::JoinHandle<()>>;
    {
        let mut guard = server_state.lock().await;
        if let Some(tx) = guard.shutdown_tx.take() {
            println!("Auth [Debug]: Sending shutdown signal to server...");
            let _ = tx.send(());
            server_task_join_handle = guard.join_handle.take();
            println!("Auth [Debug]: Shutdown signal sent.");
        } else {
            println!("Auth [Debug]: Server already shut down or handle missing.");
            return;
        }
    }

    if let Some(handle) = server_task_join_handle {
        println!("Auth [Debug]: Waiting for server task to finish...");
        match tokio::time::timeout(std::time::Duration::from_secs(5), handle).await {
            Ok(Ok(_)) => println!("Auth [Debug]: Server task joined successfully."),
            Ok(Err(e)) => eprintln!(
                "Auth [Debug]: Server task panicked or finished with error: {}",
                e
            ),
            Err(_) => eprintln!("Auth [Debug]: Timed out waiting for server task to finish."),
        }
    } else {
        println!("Auth [Debug]: No server task handle found to join.");
    }
}

// Axum Callback Handler (Only compiled in debug builds)
#[cfg(debug_assertions)]
async fn github_callback_handler(
    Query(params): Query<CallbackParams>,
    AxumState(pending_state): AxumState<PendingAuthState>,
) -> Html<String> {
    println!(
        "Auth [Debug] Callback: Received. State: {}, Code: [hidden]",
        params.state
    );

    let sender = pending_state.lock().unwrap().remove(&params.state);

    match sender {
        Some(tx) => {
            println!("Auth [Debug] Callback: State matched. Sending code via channel.");
            let send_result = tx.send(Ok(params.code));
            if send_result.is_err() {
                eprintln!(
          "Auth [Debug] Callback: Receiver dropped (Task likely timed out/errored). State: {}",
          params.state
        );
                return Html( "<html><body><h1>Auth Error</h1><p>App no longer waiting. Timeout/cancelled? Close & retry.</p></body></html>".to_string() );
            }
            Html( "<html><body><h1>Auth Success</h1><p>You can close this window.</p><script>window.close();</script></body></html>".to_string() )
        }
        None => {
            eprintln!(
                "Auth [Debug] Callback: Invalid or expired state received: {}",
                params.state
            );
            Html( "<html><body><h1>Auth Failed</h1><p>Invalid/expired state. Close & retry.</p></body></html>".to_string() )
        }
    }
}

// --- === CORE API INTERACTION LOGIC (Uses embedded config via accessors, with logging) === ---

// Exchanges the authorization code for an access token
async fn exchange_code_for_token(code: &str) -> Result<GithubTokenResponse, AuthError> {
    let client = reqwest::Client::new();
    let redirect_uri = get_redirect_uri();
    // Use accessors to get compile-time embedded values
    let github_client_id = get_github_client_id();
    let github_client_secret = get_github_client_secret();

    // Log parameters being used for the request
    println!(
        "Auth: Exchanging code. Using Client ID: '{}'",
        github_client_id
    );
    let secret_len = github_client_secret.len();
    let masked_secret = if secret_len > 4 {
        format!("***{}", &github_client_secret[secret_len - 4..])
    } else {
        "***".to_string()
    };
    println!(
        "Auth: Exchanging code. Using Client Secret: '{}'",
        masked_secret
    );
    println!(
        "Auth: Exchanging code. Using Redirect URI: '{}'",
        redirect_uri
    );
    println!("Auth: Exchanging code. Using Code: [hidden]"); // Don't log the code itself

    let params = [
        ("client_id", github_client_id),
        ("client_secret", github_client_secret),
        ("code", code),
        ("redirect_uri", redirect_uri),
    ];

    let response = client
        .post("https://github.com/login/oauth/access_token")
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "Tauri GitHub Auth (Rust)")
        .form(&params)
        .send()
        .await?;

    if response.status().is_success() {
        let token_response = response
            .json::<GithubTokenResponse>()
            .await
            .map_err(|e| AuthError::ParseError(format!("Failed to parse token response: {}", e)))?;
        if token_response.access_token.is_empty() {
            eprintln!("Auth: Token exchange successful but received empty access token.");
            Err(AuthError::GitHubError(
                "Received empty access token from GitHub".to_string(),
            ))
        } else {
            println!("Auth: Token exchanged successfully.");
            Ok(token_response)
        }
    } else {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        eprintln!(
            "Auth: GitHub token exchange error ({}): {}",
            status, error_text
        );
        Err(AuthError::GitHubError(format!(
            "Failed to exchange code (status {}): {}",
            status, error_text
        )))
    }
}

// Fetches the user's profile from the GitHub API using the access token
async fn fetch_github_user_profile(access_token: &str) -> Result<GithubUserProfile, AuthError> {
    let client = reqwest::Client::new();
    println!("Auth: Fetching GitHub profile using token: Bearer ***"); // Don't log token

    let response = client
        .get("https://api.github.com/user")
        .header(AUTHORIZATION, format!("Bearer {}", access_token)) // Use Bearer token auth
        .header(USER_AGENT, "Tauri GitHub Auth (Rust)")
        .send()
        .await?;

    if response.status().is_success() {
        let profile = response.json::<GithubUserProfile>().await.map_err(|e| {
            AuthError::ParseError(format!("Failed to parse GitHub user profile: {}", e))
        })?;
        println!(
            "Auth: User profile fetched successfully for {}.",
            profile.login
        );
        Ok(profile)
    } else {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        eprintln!(
            "Auth: GitHub profile fetch error ({}): {}",
            status, error_text
        );
        Err(AuthError::GitHubError(format!(
            "Failed to fetch user profile (status {}): {}",
            status, error_text
        )))
    }
}

// Sends the fetched GitHub profile to your backend worker/API
async fn sync_user_profile_to_backend(profile: &GithubUserProfile) -> Result<(), AuthError> {
    println!("Auth: Attempting backend sync for user ID: {}", profile.id);
    let client = reqwest::Client::new();
    let payload = BackendSyncPayload { profile };

    // Use accessors to get compile-time embedded values for backend API
    let worker_api_url = get_worker_api_url();
    let worker_api_key = get_worker_api_key();

    println!("Auth: Syncing to backend URL: {}", worker_api_url);
    let key_len = worker_api_key.len();
    let masked_key = if key_len > 4 {
        format!("***{}", &worker_api_key[key_len - 4..])
    } else {
        "***".to_string()
    };
    println!("Auth: Syncing with backend API Key: {}", masked_key);

    let response = client
        .post(worker_api_url)
        .header(AUTHORIZATION, format!("Bearer {}", worker_api_key))
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "Tauri Backend Sync (Rust)")
        .json(&payload)
        .send()
        .await?;

    let status = response.status();
    println!("Auth: Backend sync response status: {}", status);

    if status.is_success() {
        match response.json::<BackendSyncResponse>().await {
            Ok(sync_response) => {
                if sync_response.success {
                    println!("Auth: Backend sync reported success.");
                    Ok(())
                } else {
                    let err_msg = format!(
                        "Backend reported sync failure: {}",
                        sync_response.message.unwrap_or_default()
                    );
                    eprintln!("Auth: {}", err_msg);
                    Err(AuthError::BackendSyncFailed(err_msg))
                }
            }
            Err(e) => {
                let err_msg = format!("Failed to parse successful backend sync response: {}", e);
                eprintln!("Auth: {}", err_msg);
                Err(AuthError::ParseError(err_msg)) // Treat parse error as backend failure
            }
        }
    } else {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| format!("HTTP error {}", status));
        let err_msg = format!(
            "Backend API returned error (status {}): {}",
            status, error_text
        );
        eprintln!("Auth: {}", err_msg);
        Err(AuthError::BackendSyncFailed(err_msg))
    }
}

src-tauri/src/main.rs:
// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Declare modules if auth.rs is alongside main.rs
mod auth;

// Use necessary items from auth module
#[cfg(debug_assertions)]
use auth::AuthServerState;
use auth::{login_with_github, AuthError, PendingAuthState}; // Keep conditional server state import

use dotenvy::dotenv;
use std::collections::HashMap;
use tauri::{Emitter, Manager, Runtime, State}; // Add Runtime, Remove Emitter (not used directly in main.rs setup)
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url; // <-- IMPORT Url for parsing

// --- Configuration ---
// Helper function to get the production redirect URI base used for deep linking
fn get_production_callback_base() -> &'static str {
    // Must match the scheme and host/path part of your production redirect URI
    // defined in auth.rs's get_redirect_uri() for non-debug builds.
    "revision://github/callback"
}

// Define the greet command here
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
// --- Main App Setup ---
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load environment variables based on build profile
    if cfg!(debug_assertions) {
        println!("Main: Loading .env.development");
        match dotenvy::from_filename(".env.development") {
            Ok(_) => println!("Main: Successfully loaded .env.development"),
            Err(e) => println!(
                "Main: Could not load .env.development - {}. Relying on system env vars.",
                e
            ),
        }
    } else {
        println!("Main: Loading .env.production");
        match dotenvy::from_filename(".env.production") {
            Ok(_) => println!("Main: Successfully loaded .env.production"),
            Err(e) => println!(
                "Main: Could not load .env.production - {}. Relying on system env vars.",
                e
            ),
        }
    }
    // Optionally, load default .env as a fallback or for shared variables
    dotenv().ok();

    let pending_auth_state = PendingAuthState::default();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_screenshots::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .manage(pending_auth_state.clone())
        .invoke_handler(tauri::generate_handler![greet, login_with_github]);

    #[cfg(debug_assertions)]
    {
        builder = builder.manage(AuthServerState::default());
        println!("Auth [Debug]: Server state managed.");
    }

    builder
        .setup(move |app| { // Use move closure to capture pending_auth_state clone if needed directly, or use app.state()
            // --- Deep Link Handler Setup ---
            // Register the handler. It will only be called if the OS is configured
            // via tauri.conf.json to route the custom scheme URLs to the app.
            println!("Deep Link: Registering on_open_url handler (will activate if scheme configured).");
            let handle = app.handle().clone(); // Get an AppHandle

            app.deep_link().on_open_url(move |event| {

                let received_urls: Vec<Url> = event.urls();



                // Get the pending auth state atomically using the captured handle
                let pending_state = handle.state::<PendingAuthState>(); // Get managed state

                for url in received_urls {
                    let url_str = url.to_string();
                    if url_str.starts_with(get_production_callback_base()) {
                        println!("Deep Link: Matched production callback URL: {}", url_str);

                        let params: HashMap<String, String> = url
                            .query_pairs()
                            .into_owned()
                            .collect();

                        if let (Some(code), Some(state)) = (params.get("code"), params.get("state")) {
                            println!("Deep Link: Extracted State: {}, Code: [hidden]", state);

                            let sender = {
                                let mut map_guard = pending_state.lock().expect("Failed to lock pending auth state for deep link");
                                map_guard.remove(state)
                            };

                            match sender {
                                Some(tx) => {
                                    println!("Deep Link: State matched. Sending code via channel.");
                                    let send_result = tx.send(Ok(code.clone()));
                                    if send_result.is_err() {
                                        eprintln!("Deep Link: Receiver dropped (Auth task likely timed out or errored). State: {}", state);
                                        let _ = handle.emit("github_auth_error", Some(&AuthError::CallbackTimeout));
                                    } else {
                                         println!("Deep Link: Code sent successfully for state: {}", state);
                                    }
                                }
                                None => {
                                    eprintln!("Deep Link: Invalid or expired state received: {}", state);
                                    let _ = handle.emit("github_auth_error", Some(&AuthError::InvalidState));
                                }
                            }
                        } else {
                            eprintln!("Deep Link: Callback URL missing 'code' or 'state' parameter: {}", url_str);
                            let _ = handle.emit("github_auth_error", Some(&AuthError::DeepLinkError("Missing code or state".to_string())));
                        }
                        // break; // Optional: uncomment if you only expect one matching URL
                    } else {
                         println!("Deep Link: Ignoring URL (not the expected callback): {}", url_str);
                    }
                }
            }); // end on_open_url

            Ok(())
        }) // end setup
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
```
