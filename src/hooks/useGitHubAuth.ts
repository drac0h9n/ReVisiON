// src/login/hooks/useGitHubAuth.ts
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
