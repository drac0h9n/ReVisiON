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
