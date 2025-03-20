// src/app/(auth)/login/page.tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthStore } from "@/stores/authStore";
import { useGitHubAuth } from "@/hooks/useAuth";
import { AuthStatus } from "@/types/auth";

export default function LoginPage() {
  const navigate = useNavigate();
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const { handleLogin, isLoading } = useGitHubAuth();

  // Redirect if already authenticated
  useEffect(() => {
    if (status === AuthStatus.AUTHENTICATED && user) {
      navigate("/chat/new");
    }
  }, [status, user, navigate]);

  const initiateGitHubAuth = async () => {
    try {
      await handleLogin();
      // Redirect is handled by the hook
    } catch (error) {
      console.error("GitHub authentication failed:", error);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center mb-6">
            <div className="w-20 h-20 bg-primary rounded-full flex items-center justify-center text-2xl font-bold text-primary-foreground mb-4">
              AI
            </div>
            <h2 className="text-2xl font-bold mb-2">智能对话助手</h2>
            <p className="text-muted-foreground text-center">
              你的AI助手，随时为你解答问题
            </p>
          </div>

          <div className="space-y-4">
            <Button
              onClick={initiateGitHubAuth}
              className="w-full flex items-center justify-center gap-2"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></span>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  className="mr-2"
                >
                  <path
                    fill="currentColor"
                    d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                  />
                </svg>
              )}
              使用 GitHub 登录
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t"></span>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  或者
                </span>
              </div>
            </div>

            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                其他登录方式即将推出
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => navigate("/chat/new")}
              >
                以访客身份继续
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
