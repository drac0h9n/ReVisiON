// src/app/chat/new/page.tsx
import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Message } from "@/components/chat/message";
import { ChatInput } from "@/components/chat/chat-input";

interface ChatMessage {
  id: string;
  content: string;
  isUser: boolean;
}

export default function NewChatPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // 获取URL中的主题参数
  const topic = searchParams.get("topic");

  useEffect(() => {
    // 根据不同的主题，显示不同的欢迎消息
    let welcomeMessage = "你好！我是AI助手。有什么我可以帮助你的吗？";

    if (topic) {
      switch (topic) {
        case "learning":
          welcomeMessage =
            "你好！我是你的学习助手。有什么学习上的问题需要解答吗？";
          break;
        case "programming":
          welcomeMessage = "你好！我是你的编程顾问。有什么编程问题需要帮助吗？";
          break;
        case "writing":
          welcomeMessage =
            "你好！我是你的写作助手。需要文章润色、创意写作或语法检查吗？";
          break;
        case "travel":
          welcomeMessage =
            "你好！我是你的旅游顾问。需要旅游攻略、景点推荐或行程规划吗？";
          break;
      }
    }

    setMessages([
      {
        id: Date.now().toString(),
        content: welcomeMessage,
        isUser: false,
      },
    ]);
  }, [topic]);

  const handleSendMessage = (content: string) => {
    // 生成新的消息ID
    const newChatId = Date.now().toString();

    const newUserMessage: ChatMessage = {
      id: newChatId,
      content,
      isUser: true,
    };

    setMessages((prev) => [...prev, newUserMessage]);

    // 模拟AI响应
    setTimeout(() => {
      const aiResponse: ChatMessage = {
        id: (Date.now() + 1).toString(),
        content: `正在处理你的问题："${content}"，请稍候...`,
        isUser: false,
      };
      setMessages((prev) => [...prev, aiResponse]);

      // 模拟创建新的聊天会话并跳转
      setTimeout(() => {
        // 实际应用中，你会将对话保存到后端并获取唯一ID
        navigate(`/chat/${newChatId}`);
      }, 1500);
    }, 1000);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.map((message) => (
          <Message
            key={message.id}
            content={message.content}
            isUser={message.isUser}
          />
        ))}
      </div>
      <ChatInput onSend={handleSendMessage} />
    </div>
  );
}
