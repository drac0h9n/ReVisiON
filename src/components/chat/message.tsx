// src/components/chat/message.tsx
import { cn } from "@/lib/utils";

interface MessageProps {
  content: string;
  isUser: boolean;
}

export function Message({ content, isUser }: MessageProps) {
  return (
    <div
      className={cn(
        "max-w-[80%] rounded-lg p-3",
        isUser
          ? "bg-primary text-primary-foreground self-end rounded-br-sm"
          : "bg-muted self-start rounded-bl-sm"
      )}
    >
      {content}
    </div>
  );
}
