// src/app/profile/page.tsx
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function ProfilePage() {
  const [username, setUsername] = useState("张力");
  const [email, setEmail] = useState("zhangli@example.com");
  const [isEditing, setIsEditing] = useState(false);

  // 模拟提交处理
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsEditing(false);
    // 实际应用中，你会将更新后的信息发送到后端
  };

  return (
    <div className="container mx-auto py-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">个人资料</h1>

      <div className="flex items-center gap-4 mb-8">
        <Avatar className="h-20 w-20">
          <AvatarFallback className="text-2xl">ZL</AvatarFallback>
        </Avatar>
        <div>
          <h2 className="text-xl font-semibold">{username}</h2>
          <p className="text-muted-foreground">{email}</p>
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <h3 className="text-lg font-semibold mb-4">账户信息</h3>

          {isEditing ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="flex gap-2">
                <Button type="submit">保存</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEditing(false)}
                >
                  取消
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-sm text-muted-foreground mb-1">用户名</div>
                <div>{username}</div>
              </div>

              <div>
                <div className="text-sm text-muted-foreground mb-1">邮箱</div>
                <div>{email}</div>
              </div>

              <Button onClick={() => setIsEditing(true)}>编辑信息</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <h3 className="text-lg font-semibold mb-4">订阅状态</h3>

          <div className="flex justify-between items-center mb-4">
            <div>
              <div className="font-medium">普通会员</div>
              <div className="text-sm text-muted-foreground">
                有效期至 2023年12月15日
              </div>
            </div>
            <Button variant="outline">升级</Button>
          </div>

          <Separator className="my-4" />

          <div className="text-sm text-muted-foreground mb-2">会员特权</div>
          <ul className="space-y-2">
            <li className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              <span>无限对话次数</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              <span>优先使用最新模型</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-red-500">✗</span>
              <span className="text-muted-foreground">
                高级知识库接入 (仅专业版)
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-red-500">✗</span>
              <span className="text-muted-foreground">
                API访问权限 (仅专业版)
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <h3 className="text-lg font-semibold mb-4">使用统计</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground">总对话数</div>
              <div className="text-3xl font-semibold mt-1">124</div>
            </div>

            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground">本月使用时长</div>
              <div className="text-3xl font-semibold mt-1">8.5小时</div>
            </div>

            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground">已保存聊天</div>
              <div className="text-3xl font-semibold mt-1">16</div>
            </div>

            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground">平均满意度</div>
              <div className="text-3xl font-semibold mt-1">4.8 / 5</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h3 className="text-lg font-semibold mb-4">安全设置</h3>

          <div className="space-y-4">
            <Button variant="outline" className="w-full">
              修改密码
            </Button>
            <Button variant="destructive" className="w-full">
              删除账户
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
