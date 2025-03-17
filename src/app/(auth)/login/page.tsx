// src/app/(auth)/login/page.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // 在实际应用中添加登录逻辑
    navigate("/chat/new");
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

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                placeholder="请输入邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="remember"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <label htmlFor="remember" className="text-sm">
                  记住我
                </label>
              </div>
              <a href="#" className="text-sm text-primary hover:underline">
                忘记密码？
              </a>
            </div>

            <Button type="submit" className="w-full">
              登录
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => navigate("/register")}
            >
              注册账号
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
