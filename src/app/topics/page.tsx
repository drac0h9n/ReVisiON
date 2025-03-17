// src/app/topics/page.tsx
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";

interface Topic {
  id: string;
  icon: string;
  title: string;
  description: string;
}

export default function TopicsPage() {
  const navigate = useNavigate();

  const topics: Topic[] = [
    {
      id: "learning",
      icon: "🎓",
      title: "学习助手",
      description: "解答学科问题，提供学习资料推荐",
    },
    {
      id: "programming",
      icon: "💻",
      title: "编程顾问",
      description: "编程问题解答，代码审查与优化",
    },
    {
      id: "writing",
      icon: "✍️",
      title: "写作助手",
      description: "文章润色，创意写作，语法检查",
    },
    {
      id: "travel",
      icon: "🌍",
      title: "旅游顾问",
      description: "旅游攻略，景点推荐，行程规划",
    },
  ];

  const handleSelectTopic = (topicId: string) => {
    // 在实际应用中，这里会创建一个带有该主题的新对话
    navigate(`/chat/new?topic=${topicId}`);
  };

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-2xl font-bold mb-2">选择聊天主题</h1>
      <p className="text-muted-foreground mb-8">
        选择一个主题，AI将专注于相关领域为你提供帮助
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {topics.map((topic) => (
          <Card
            key={topic.id}
            className="cursor-pointer hover:shadow-md transition-all hover:-translate-y-1 hover:border-primary/20"
            onClick={() => handleSelectTopic(topic.id)}
          >
            <CardContent className="p-6">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center text-2xl mb-4">
                {topic.icon}
              </div>
              <h3 className="font-semibold mb-2">{topic.title}</h3>
              <p className="text-sm text-muted-foreground">
                {topic.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
