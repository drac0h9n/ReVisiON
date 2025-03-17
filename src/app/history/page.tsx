// src/app/history/page.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface HistoryItem {
  id: string;
  title: string;
  preview: string;
  date: string;
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");

  const historyItems: HistoryItem[] = [
    {
      id: "ai-basics",
      title: "人工智能的发展历史",
      preview:
        '人工智能的发展可以追溯到1950年代。计算机科学家Alan Turing提出了著名的"图灵测试"...',
      date: "2023年10月15日 14:30",
    },
    {
      id: "travel",
      title: "旅游计划：日本东京",
      preview: "东京是一个融合了传统和现代的城市，这里有很多值得游览的地方...",
      date: "2023年10月10日 09:15",
    },
    {
      id: "programming",
      title: "Python编程问题",
      preview:
        "关于Python列表推导式的语法，你可以这样使用：[x for x in range(10) if x % 2 == 0]...",
      date: "2023年10月5日 16:45",
    },
    {
      id: "english",
      title: "英语学习：常用短语",
      preview:
        "以下是一些在日常对话中常用的英语短语：Nice to meet you（很高兴认识你）...",
      date: "2023年9月28日 11:20",
    },
  ];

  const filteredItems = historyItems.filter(
    (item) =>
      item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.preview.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-2xl font-bold mb-6">对话历史</h1>

      <div className="mb-4">
        <Input
          placeholder="搜索历史对话..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="flex justify-between mb-4">
        <Select defaultValue="all">
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="过滤时间" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有对话</SelectItem>
            <SelectItem value="week">本周</SelectItem>
            <SelectItem value="month">本月</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="destructive" size="sm">
          清空历史
        </Button>
      </div>

      <div className="space-y-4">
        {filteredItems.map((item) => (
          <Card
            key={item.id}
            className="cursor-pointer hover:bg-muted/50"
            onClick={() => navigate(`/chat/${item.id}`)}
          >
            <CardContent className="p-4">
              <h3 className="font-semibold">{item.title}</h3>
              <p className="text-sm text-muted-foreground truncate mt-1">
                {item.preview}
              </p>
              <p className="text-xs text-muted-foreground mt-2">{item.date}</p>
            </CardContent>
          </Card>
        ))}

        {filteredItems.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            没有找到匹配的历史记录
          </div>
        )}
      </div>
    </div>
  );
}
