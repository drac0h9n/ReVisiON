// src/hooks/useGitHubAuth.ts
import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

// 1. 定义类型 (可以放在 hook 文件内，或单独的 types 文件)
type AuthState = "idle" | "loading" | "success" | "error";

interface GitHubProfile {
  login: string;
  id: number;
  name?: string;
  avatar_url: string;
  email?: string;
}

// 2. 定义 Hook 返回值的类型 (可选，但推荐)
interface UseGitHubAuthReturn {
  authState: AuthState;
  userProfile: GitHubProfile | null;
  authError: string | null;
  login: () => Promise<void>; // 重命名 handleGitHubLogin 为 login
  logout: () => void; // 重命名 handleLogout 为 logout
}

// 3. 创建自定义 Hook
export function useGitHubAuth(): UseGitHubAuthReturn {
  // 4. 将 State 和 Refs 移入 Hook
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [userProfile, setUserProfile] = useState<GitHubProfile | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const unlistenSuccessRef = useRef<UnlistenFn | null>(null);
  const unlistenErrorRef = useRef<UnlistenFn | null>(null);

  // 5. 将 useEffect (事件监听逻辑) 移入 Hook
  useEffect(() => {
    let isMounted = true;

    const setupListeners = async () => {
      try {
        // --- 成功监听器 ---
        const successListener = await listen<{
          token: string; // Token 可能不需要在 Hook 外部使用，但类型需要匹配
          profile: GitHubProfile;
        }>("github_auth_success", (event) => {
          if (isMounted) {
            console.log("GitHub Auth Success Event:", event.payload);
            setUserProfile(event.payload.profile);
            setAuthState("success");
            setAuthError(null);
          }
        });

        // --- 错误监听器 ---
        const errorListener = await listen<any>(
          "github_auth_error",
          (event) => {
            if (isMounted) {
              console.error("GitHub Auth Error Event:", event.payload);
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
              setAuthError(errorMessage);
              setAuthState("error");
              setUserProfile(null);
            }
          }
        );

        // --- 存储清理函数 ---
        unlistenSuccessRef.current = successListener;
        unlistenErrorRef.current = errorListener;
        console.log("Auth event listeners attached.");
      } catch (error) {
        console.error("Failed to setup auth listeners:", error);
        if (isMounted) {
          setAuthError("Failed to initialize authentication listeners.");
          setAuthState("error");
        }
      }
    };

    setupListeners();

    // --- 清理函数 ---
    return () => {
      isMounted = false;
      console.log("Cleaning up auth listeners...");
      if (unlistenSuccessRef.current) {
        unlistenSuccessRef.current();
        console.log("Success listener detached.");
      }
      if (unlistenErrorRef.current) {
        unlistenErrorRef.current();
        console.log("Error listener detached.");
      }
    };
  }, []); // 依赖项不变

  // 6. 将触发登录的函数移入 Hook，重命名并用 useCallback 包裹
  const login = useCallback(async () => {
    setAuthState("loading");
    setAuthError(null);
    setUserProfile(null);
    try {
      console.log("Invoking login_with_github command...");
      const authUrl = await invoke<string>("login_with_github");
      console.log("Received auth URL:", authUrl);
      await openUrl(authUrl);
      console.log("GitHub auth URL opened. Waiting for events...");
    } catch (error: any) {
      console.error("Failed to initiate GitHub login or open URL:", error);
      setAuthError(`Failed to start login process: ${error?.message || error}`);
      setAuthState("error");
    }
  }, []); // 空依赖数组，因为内部没有依赖外部变量

  // 7. 将登出函数移入 Hook，重命名
  const logout = useCallback(() => {
    setUserProfile(null);
    setAuthState("idle");
    setAuthError(null);
    console.log("User logged out (client-side state cleared).");
    // 注意：这里只是清除了客户端状态。如果需要，
    // 可能还需要调用后端来使 token 失效等。
  }, []); // 空依赖

  // 8. 返回 Hook 需要暴露给组件的状态和函数
  return {
    authState,
    userProfile,
    authError,
    login,
    logout,
  };
}
