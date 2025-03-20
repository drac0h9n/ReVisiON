// src/app/layout.tsx
import { Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Sidebar from "@/components/layout/sidebar";
import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";

// 创建 QueryClient 实例
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout() {
  const initAuth = useAuthStore((state) => state.initAuth);

  // 应用启动时初始化认证状态
  useEffect(() => {
    initAuth();
  }, [initAuth]);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen bg-background">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </QueryClientProvider>
  );
}
