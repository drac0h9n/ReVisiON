// src/app/settings/page.tsx
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  return (
    <div className="container mx-auto py-6">
      <h1 className="text-2xl font-bold mb-6">设置</h1>

      <div className="space-y-8">
        <div>
          <h3 className="text-lg font-semibold mb-4">个性化</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">深色模式</div>
                <div className="text-sm text-muted-foreground">
                  切换深色/浅色显示模式
                </div>
              </div>
              <Switch />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">语言</div>
                <div className="text-sm text-muted-foreground">
                  选择界面显示语言
                </div>
              </div>
              <Select defaultValue="zh-CN">
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="选择语言" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh-CN">简体中文</SelectItem>
                  <SelectItem value="en-US">English</SelectItem>
                  <SelectItem value="ja-JP">日本語</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-4">AI 助手</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">回答长度</div>
                <div className="text-sm text-muted-foreground">
                  设置AI回答的详细程度
                </div>
              </div>
              <Select defaultValue="medium">
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="选择长度" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="short">简短</SelectItem>
                  <SelectItem value="medium">中等</SelectItem>
                  <SelectItem value="long">详细</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">保留对话历史</div>
                <div className="text-sm text-muted-foreground">
                  AI会记住当前对话中的上下文
                </div>
              </div>
              <Switch defaultChecked />
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-4">隐私与安全</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">数据收集</div>
                <div className="text-sm text-muted-foreground">
                  允许收集匿名使用数据以改进服务
                </div>
              </div>
              <Switch defaultChecked />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">自动清除历史</div>
                <div className="text-sm text-muted-foreground">
                  自动删除30天前的对话记录
                </div>
              </div>
              <Switch />
            </div>
          </div>
        </div>

        <Button className="mt-6">保存设置</Button>
      </div>
    </div>
  );
}
