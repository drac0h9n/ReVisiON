// src/stores/authStore.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { User, AuthStatus } from "@/types/auth";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  error: string | null;
  isLoading: boolean;

  // 状态转换方法
  initAuth: () => Promise<void>;
  startAuth: () => void;
  setAuthenticated: (user: User) => void;
  setUnauthenticated: (error?: string) => void;
  logout: () => Promise<void>;
  refreshUserInfo: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // 初始状态
      status: AuthStatus.INITIAL,
      user: null,
      error: null,
      isLoading: false,

      // 初始化认证状态 - 应用启动时检查是否已有会话
      initAuth: async () => {
        try {
          set({ isLoading: true });
          const response = await fetch("https://chat.l1nk.mom/api/me", {
            credentials: "include", // 确保发送 cookies
          });

          if (response.ok) {
            const user = await response.json();
            set({
              status: AuthStatus.AUTHENTICATED,
              user,
              error: null,
              isLoading: false,
            });
          } else {
            set({
              status: AuthStatus.UNAUTHENTICATED,
              user: null,
              error: null,
              isLoading: false,
            });
          }
        } catch (error) {
          console.error("Failed to initialize auth:", error);
          set({
            status: AuthStatus.UNAUTHENTICATED,
            user: null,
            error: error instanceof Error ? error.message : "初始化认证失败",
            isLoading: false,
          });
        }
      },

      // 开始认证流程
      startAuth: () => {
        set({
          status: AuthStatus.AUTHENTICATING,
          isLoading: true,
          error: null,
        });
      },

      // 认证成功处理
      setAuthenticated: (user: User) => {
        set({
          status: AuthStatus.AUTHENTICATED,
          user,
          error: null,
          isLoading: false,
        });
      },

      // 认证失败处理
      setUnauthenticated: (error?: string) => {
        set({
          status: AuthStatus.UNAUTHENTICATED,
          user: null,
          error: error || null,
          isLoading: false,
        });
      },

      // 注销登录
      logout: async () => {
        try {
          set({ isLoading: true });
          // 调用登出端点
          await fetch("https://chat.l1nk.mom/auth/logout", {
            method: "POST",
            credentials: "include",
          });

          set({
            status: AuthStatus.UNAUTHENTICATED,
            user: null,
            error: null,
            isLoading: false,
          });
        } catch (error) {
          console.error("Logout failed:", error);
          // 即使登出失败，也将状态设置为未认证
          set({
            status: AuthStatus.UNAUTHENTICATED,
            user: null,
            error: error instanceof Error ? error.message : "登出失败",
            isLoading: false,
          });
        }
      },

      // 刷新用户信息
      refreshUserInfo: async () => {
        const { status } = get();

        // 只有在已认证状态下才刷新用户信息
        if (status !== AuthStatus.AUTHENTICATED) {
          return;
        }

        try {
          set({ isLoading: true });

          const response = await fetch("https://chat.l1nk.mom/api/me", {
            credentials: "include",
          });

          if (response.ok) {
            const user = await response.json();
            set({ user, error: null, isLoading: false });
          } else {
            // 如果获取用户信息失败（例如，会话已过期），则设置为未认证
            if (response.status === 401 || response.status === 403) {
              set({
                status: AuthStatus.UNAUTHENTICATED,
                user: null,
                error: "会话已过期",
                isLoading: false,
              });
            } else {
              throw new Error("刷新用户信息失败");
            }
          }
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : "刷新用户信息失败",
            isLoading: false,
          });
        }
      },
    }),
    {
      name: "auth-storage", // 存储在 localStorage 的键名
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // 只持久化状态和用户信息，不持久化错误和加载状态
        status: state.status,
        user: state.user,
      }),
    }
  )
);
