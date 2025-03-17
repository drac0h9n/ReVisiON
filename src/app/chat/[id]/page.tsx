// src/app/chat/[id]/page.tsx
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Message } from "@/components/chat/message";
import { ChatInput } from "@/components/chat/chat-input";

interface ChatMessage {
  id: string;
  content: string;
  isUser: boolean;
}

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    // 在实际应用中，你会基于ID获取聊天历史
    const initialMessages: ChatMessage[] = [
      {
        id: "1",
        content: "你好！我是AI助手。有什么我可以帮助你的吗？",
        isUser: false,
      },
    ];

    if (id === "ai-basics") {
      initialMessages.push(
        {
          id: "2",
          content: "我想了解一下人工智能的发展历史",
          isUser: true,
        },
        {
          id: "3",
          content:
            '人工智能的发展可以追溯到1950年代。计算机科学家Alan Turing提出了著名的"图灵测试"，这被认为是人工智能领域的开端。之后，人工智能经历了几次发展高潮和低谷，被称为"AI的春夏秋冬"。近年来，随着深度学习技术的突破，人工智能再次迎来蓬勃发展。',
          isUser: false,
        },
        {
          id: "4",
          content: "深度学习是什么？",
          isUser: true,
        },
        {
          id: "5",
          content:
            "深度学习是机器学习的一个分支，它使用多层神经网络来模拟人脑的学习过程。这些网络能够从大量数据中学习特征和模式，而不需要人工特征工程。深度学习在图像识别、自然语言处理等领域取得了突破性进展，是当前AI发展的主要推动力。",
          isUser: false,
        }
      );
    }

    setMessages(initialMessages);
  }, [id]);

  const handleSendMessage = (content: string) => {
    const newUserMessage: ChatMessage = {
      id: Date.now().toString(),
      content,
      isUser: true,
    };

    setMessages((prev) => [...prev, newUserMessage]);

    // 模拟AI响应
    setTimeout(() => {
      const aiResponse: ChatMessage = {
        id: (Date.now() + 1).toString(),
        content: `我是AI助手，你的问题是关于：${content}。我正在思考回答...`,
        isUser: false,
      };
      setMessages((prev) => [...prev, aiResponse]);
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
