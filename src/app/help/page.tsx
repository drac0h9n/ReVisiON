// src/app/help/page.tsx
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export default function HelpPage() {
  return (
    <div className="container mx-auto py-6">
      <h1 className="text-2xl font-bold mb-6">帮助中心</h1>

      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="item-1">
          <AccordionTrigger>如何开始一个新对话？</AccordionTrigger>
          <AccordionContent>
            点击侧边栏的"新对话"按钮或导航到主页，即可开始一个新的对话。你可以直接输入问题或从推荐的主题中选择一个开始。
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-2">
          <AccordionTrigger>AI助手可以帮我做什么？</AccordionTrigger>
          <AccordionContent>
            我们的AI助手可以回答各种问题，提供信息，帮助学习和工作。它可以解释概念，提供教程，协助写作，规划旅行，以及提供编程帮助等。但请注意，AI助手不能替代专业建议，特别是在医疗、法律等专业领域。
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-3">
          <AccordionTrigger>如何保存和查看历史对话？</AccordionTrigger>
          <AccordionContent>
            所有对话会自动保存。你可以通过侧边栏的"历史记录"按钮查看过去的对话。在历史记录页面，你可以搜索、过滤和删除历史对话。
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-4">
          <AccordionTrigger>如何更改AI回答的详细程度？</AccordionTrigger>
          <AccordionContent>
            在"设置"页面的"AI助手"部分，你可以调整"回答长度"选项，选择简短、中等或详细的回答风格。
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-5">
          <AccordionTrigger>我的对话数据安全吗？</AccordionTrigger>
          <AccordionContent>
            我们非常重视用户隐私。你可以在"设置"页面的"隐私与安全"部分调整数据收集和历史记录保留的选项。如有需要，你也可以手动删除历史对话或设置自动清除历史记录。
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
