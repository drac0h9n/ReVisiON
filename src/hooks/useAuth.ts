// src/hooks/useAuth.ts
import { useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/authStore";
import { User, GitHubAuthResponse, AuthStatus } from "@/types/auth";

// 检查当前用户会话
export const useCheckSession = () => {
  const queryClient = useQueryClient();
  const { initAuth, status } = useAuthStore();

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: async (): Promise<User> => {
      const response = await fetch("https://chat.l1nk.mom/api/me", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("会话已过期或无效");
      }

      return response.json();
    },
    enabled: status === AuthStatus.INITIAL,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5分钟
  });

  // 使用 useEffect 监听查询结果
  useEffect(() => {
    if (sessionQuery.isSuccess && sessionQuery.data) {
      useAuthStore.getState().setAuthenticated(sessionQuery.data);
    } else if (sessionQuery.isError) {
      useAuthStore.getState().setUnauthenticated();
    }
  }, [sessionQuery.isSuccess, sessionQuery.isError, sessionQuery.data]);

  // 应用启动时初始化认证状态
  useEffect(() => {
    if (status === AuthStatus.INITIAL) {
      initAuth();
    }
  }, [status, initAuth]);

  // 提供重新验证会话的方法
  const refreshSession = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["session"] });
  }, [queryClient]);

  return {
    isLoading: sessionQuery.isPending,
    isSuccess: sessionQuery.isSuccess,
    isError: sessionQuery.isError,
    refreshSession,
  };
};

// GitHub 认证流程
export const useGitHubAuth = () => {
  const { startAuth, setAuthenticated, setUnauthenticated } = useAuthStore();
  const queryClient = useQueryClient();

  // 获取 GitHub 认证 URL
  const getGitHubAuthUrlMutation = useMutation({
    mutationFn: async (): Promise<GitHubAuthResponse> => {
      const response = await fetch("https://chat.l1nk.mom/auth/github", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("无法获取 GitHub 认证 URL");
      }

      return response.json();
    },
  });

  // 监听 GitHub URL 获取结果
  useEffect(() => {
    if (getGitHubAuthUrlMutation.isSuccess && getGitHubAuthUrlMutation.data) {
      // 重定向到 GitHub 进行认证
      window.location.href = getGitHubAuthUrlMutation.data.url;
    }
  }, [getGitHubAuthUrlMutation.isSuccess, getGitHubAuthUrlMutation.data]);

  // 处理 GitHub 认证回调
  const handleGitHubCallbackMutation = useMutation({
    mutationFn: async (params: {
      code: string;
      state: string;
    }): Promise<User> => {
      const { code, state } = params;
      const url = `https://chat.l1nk.mom/auth/github/callback?code=${code}&state=${state}`;

      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("GitHub 认证回调处理失败");
      }

      return response.json();
    },
  });

  // 监听 GitHub 回调处理结果
  useEffect(() => {
    if (
      handleGitHubCallbackMutation.isSuccess &&
      handleGitHubCallbackMutation.data
    ) {
      setAuthenticated(handleGitHubCallbackMutation.data);
      queryClient.invalidateQueries({ queryKey: ["session"] });
    } else if (handleGitHubCallbackMutation.isError) {
      const errorMessage =
        handleGitHubCallbackMutation.error instanceof Error
          ? handleGitHubCallbackMutation.error.message
          : "认证失败";
      setUnauthenticated(errorMessage);
    }
  }, [
    handleGitHubCallbackMutation.isSuccess,
    handleGitHubCallbackMutation.isError,
    handleGitHubCallbackMutation.data,
    handleGitHubCallbackMutation.error,
    setAuthenticated,
    setUnauthenticated,
    queryClient,
  ]);

  // 发起 GitHub 登录
  const handleLogin = useCallback(() => {
    startAuth();
    getGitHubAuthUrlMutation.mutate();
  }, [startAuth, getGitHubAuthUrlMutation]);

  // 处理 GitHub 回调
  const handleCallback = useCallback(
    (code: string, state: string) => {
      startAuth();
      handleGitHubCallbackMutation.mutate({ code, state });
    },
    [startAuth, handleGitHubCallbackMutation]
  );

  return {
    handleLogin,
    handleCallback,
    isLoading:
      getGitHubAuthUrlMutation.isPending ||
      handleGitHubCallbackMutation.isPending,
    isError:
      getGitHubAuthUrlMutation.isError || handleGitHubCallbackMutation.isError,
    error: getGitHubAuthUrlMutation.error || handleGitHubCallbackMutation.error,
  };
};

// 获取当前用户信息
export const useCurrentUser = () => {
  const { user, status, refreshUserInfo } = useAuthStore();

  const userQuery = useQuery({
    queryKey: ["currentUser"],
    queryFn: async (): Promise<User> => {
      const response = await fetch("https://chat.l1nk.mom/api/me", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("获取用户信息失败");
      }

      return response.json();
    },
    enabled: status === AuthStatus.AUTHENTICATED,
    staleTime: 5 * 60 * 1000, // 5分钟
  });

  // 监听用户查询结果
  useEffect(() => {
    if (userQuery.isSuccess && userQuery.data) {
      // 如果从 API 获取的用户数据与存储中的不同，则更新存储
      if (JSON.stringify(userQuery.data) !== JSON.stringify(user)) {
        useAuthStore.getState().setAuthenticated(userQuery.data);
      }
    } else if (userQuery.isError) {
      // 如果获取用户信息失败，可能是会话已过期
      useAuthStore.getState().setUnauthenticated("会话已过期");
    }
  }, [userQuery.isSuccess, userQuery.isError, userQuery.data, user]);

  // 提供手动刷新用户信息的方法
  const refresh = useCallback(() => {
    refreshUserInfo();
  }, [refreshUserInfo]);

  return {
    user,
    isAuthenticated: status === AuthStatus.AUTHENTICATED,
    isLoading: userQuery.isPending,
    isError: userQuery.isError,
    error: userQuery.error,
    refresh,
  };
};

// 登出功能
export const useLogout = () => {
  const { logout } = useAuthStore();
  const queryClient = useQueryClient();

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("https://chat.l1nk.mom/auth/logout", {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("登出失败");
      }

      return response.ok;
    },
  });

  // 监听登出结果
  useEffect(() => {
    if (logoutMutation.isSuccess) {
      logout();
      // 清除相关查询缓存
      queryClient.invalidateQueries({ queryKey: ["session"] });
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    }
  }, [logoutMutation.isSuccess, logout, queryClient]);

  const handleLogout = useCallback(() => {
    logoutMutation.mutate();
  }, [logoutMutation]);

  return {
    handleLogout,
    isLoading: logoutMutation.isPending,
    isError: logoutMutation.isError,
    error: logoutMutation.error,
  };
};
