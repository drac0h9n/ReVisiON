// src/app/(auth)/register/page.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // 基本验证
    if (!username || !email || !password || !confirmPassword) {
      setError("所有字段都是必填的");
      return;
    }

    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }

    // 在实际应用中添加注册逻辑
    // 这里只是模拟
    localStorage.setItem("isLoggedIn", "true");
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
            <h2 className="text-2xl font-bold mb-2">创建账户</h2>
            <p className="text-muted-foreground text-center">
              加入我们，开始你的AI对话之旅
            </p>
          </div>

          {error && (
            <div className="bg-destructive/10 text-destructive p-3 rounded-md mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                placeholder="请输入用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

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

            <div className="space-y-2">
              <Label htmlFor="confirm-password">确认密码</Label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="请再次输入密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            <div className="pt-2">
              <Button type="submit" className="w-full">
                注册
              </Button>
            </div>

            <div className="text-center">
              <span className="text-sm text-muted-foreground">已有账户？</span>
              <Button
                type="button"
                variant="link"
                onClick={() => navigate("/login")}
                className="text-sm"
              >
                登录
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
