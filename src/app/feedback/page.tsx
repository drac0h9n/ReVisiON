// src/app/feedback/page.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function FeedbackPage() {
  const [rating, setRating] = useState<number | null>(null);
  const [feedbackType, setFeedbackType] = useState("");
  const [feedback, setFeedback] = useState("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // 在实际应用中，你会将反馈发送到后端
    console.log({ rating, feedbackType, feedback, email });
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="container mx-auto py-6 max-w-2xl text-center">
        <div className="text-6xl mb-6">🙏</div>
        <h1 className="text-2xl font-bold mb-4">感谢你的反馈！</h1>
        <p className="text-muted-foreground mb-8">
          我们非常重视你的意见，这将帮助我们不断改进产品和服务。
        </p>
        <Button onClick={() => setSubmitted(false)}>提交新反馈</Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-2">提供反馈</h1>
      <p className="text-muted-foreground mb-6">
        你的反馈对我们改进服务非常重要
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label>你对我们的服务满意吗？</Label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${
                  rating === value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted/80"
                }`}
                onClick={() => setRating(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="feedback-type">反馈类型</Label>
          <Select value={feedbackType} onValueChange={setFeedbackType} required>
            <SelectTrigger>
              <SelectValue placeholder="请选择反馈类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="suggestion">功能建议</SelectItem>
              <SelectItem value="bug">问题报告</SelectItem>
              <SelectItem value="content">内容相关</SelectItem>
              <SelectItem value="other">其他</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="feedback-content">详细描述</Label>
          <Textarea
            id="feedback-content"
            placeholder="请详细描述你的反馈或建议..."
            className="min-h-[120px]"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="contact-email">联系方式（选填）</Label>
          <Input
            id="contact-email"
            type="email"
            placeholder="留下你的邮箱，我们可能会联系你了解更多信息"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <Button type="submit" disabled={!rating || !feedbackType || !feedback}>
          提交反馈
        </Button>
      </form>
    </div>
  );
}
