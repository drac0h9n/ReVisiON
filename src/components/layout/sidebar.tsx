// src/components/layout/sidebar.tsx
import { useNavigate, useLocation } from "react-router-dom";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="w-64 h-full bg-muted flex flex-col border-r">
      <div className="p-4 border-b flex items-center gap-2">
        <Avatar>
          <AvatarFallback>ZL</AvatarFallback>
        </Avatar>
        <div>
          <div className="font-medium">张力</div>
          <div className="text-xs text-muted-foreground">普通会员</div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <Button
          variant={isActive("/chat/new") ? "default" : "ghost"}
          className="w-full justify-start mb-4"
          onClick={() => navigate("/chat/new")}
        >
          <span className="mr-2">💬</span>
          <span>新对话</span>
        </Button>

        <div className="text-sm text-muted-foreground mb-2">最近对话</div>

        <Button
          variant={isActive("/chat/ai-basics") ? "default" : "ghost"}
          className="w-full justify-start mb-1"
          onClick={() => navigate("/chat/ai-basics")}
        >
          <span className="mr-2">📚</span>
          <span>人工智能基础知识</span>
        </Button>

        <Button
          variant={isActive("/chat/travel") ? "default" : "ghost"}
          className="w-full justify-start mb-1"
          onClick={() => navigate("/chat/travel")}
        >
          <span className="mr-2">🌍</span>
          <span>旅游计划助手</span>
        </Button>

        <Button
          variant={isActive("/chat/english") ? "default" : "ghost"}
          className="w-full justify-start mb-1"
          onClick={() => navigate("/chat/english")}
        >
          <span className="mr-2">📝</span>
          <span>英语学习辅导</span>
        </Button>

        <Button
          variant={isActive("/chat/programming") ? "default" : "ghost"}
          className="w-full justify-start mb-1"
          onClick={() => navigate("/chat/programming")}
        >
          <span className="mr-2">💻</span>
          <span>编程问题解答</span>
        </Button>

        <div className="border-t my-6 pt-6">
          <Button
            variant={isActive("/history") ? "default" : "ghost"}
            className="w-full justify-start mb-1"
            onClick={() => navigate("/history")}
          >
            <span className="mr-2">🕒</span>
            <span>历史记录</span>
          </Button>

          <Button
            variant={isActive("/settings") ? "default" : "ghost"}
            className="w-full justify-start mb-1"
            onClick={() => navigate("/settings")}
          >
            <span className="mr-2">⚙️</span>
            <span>设置</span>
          </Button>

          <Button
            variant={isActive("/help") ? "default" : "ghost"}
            className="w-full justify-start mb-1"
            onClick={() => navigate("/help")}
          >
            <span className="mr-2">❓</span>
            <span>帮助中心</span>
          </Button>
        </div>
      </div>

      <div className="p-4 border-t">
        <Button
          variant="outline"
          className="w-full"
          onClick={() => navigate("/login")}
        >
          退出登录
        </Button>
      </div>
    </div>
  );
}
