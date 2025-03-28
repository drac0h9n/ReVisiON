// src/app/page.tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/authStore";
import { AuthStatus } from "@/types/auth";
import { useCheckSession } from "@/hooks/useAuth";

export default function HomePage() {
  const navigate = useNavigate();
  const { status, user } = useAuthStore();
  // 使用React Query检查会话状态
  const { refreshSession } = useCheckSession();

  // 检查用户是否已登录，如果已登录，直接跳转到新对话页面
  useEffect(() => {
    // 初始状态时刷新会话检查
    if (status === AuthStatus.INITIAL) {
      refreshSession();
    }

    // 如果用户已认证，跳转到新对话页面
    if (status === AuthStatus.AUTHENTICATED && user) {
      navigate("/chat/new");
    }
  }, [status, user, navigate, refreshSession]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
      <div className="w-20 h-20 bg-primary rounded-full flex items-center justify-center text-2xl font-bold text-primary-foreground mb-6">
        AI
      </div>
      <h1 className="text-4xl font-bold mb-4 text-center">智能对话助手</h1>
      <p className="text-xl text-muted-foreground text-center max-w-md mb-8">
        你的AI助手，随时为你解答问题、提供帮助
      </p>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
        <Button size="lg" className="flex-1" onClick={() => navigate("/login")}>
          登录
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="flex-1"
          onClick={() => navigate("/register")}
        >
          注册
        </Button>
      </div>

      <Button
        variant="link"
        className="mt-4"
        onClick={() => navigate("/chat/new")}
      >
        先体验一下
      </Button>
    </div>
  );
}
