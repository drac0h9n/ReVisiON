// src/components/MessageBubble/MessageBubble.tsx (修改后)
import React, { useMemo } from "react";
import { Avatar, Spin, Alert, Collapse, CollapseProps } from "antd";
import { UserOutlined, RobotOutlined } from "@ant-design/icons";
import ReactMarkdown, { Options } from "react-markdown"; // Import Options type
import remarkGfm from "remark-gfm";

// Import types and components
import { ChatMessage } from "@/types/chat";
import CustomCodeBlock from "@/components/CustomCodeBlock/CustomCodeBlock"; // Crucial dependency

import styles from "./MessageBubble.module.css"; // Merged CSS Module

interface MessageBubbleProps {
  message: ChatMessage;
}

// --- Shared Markdown Components Configuration ---
// Memoize this configuration to avoid redefining it on every render
const markdownComponents: Options["components"] = {
  // Custom renderer for code blocks using CustomCodeBlock
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  code(props) {
    const { children, className, node, ref, ...rest } = props; // Include ref
    const match = /language-(\w+)/.exec(className || "");
    const codeValue = String(children).replace(/\n$/, ""); // Clean trailing newline

    return match ? (
      <CustomCodeBlock
        {...rest} // Pass down other props
        language={match[1]}
        value={codeValue}
        // node={node} // Pass node if needed by CustomCodeBlock
      />
    ) : (
      // Fallback for inline code
      <code className={`${className} ${styles.inlineCode}`} {...rest}>
        {children}
      </code>
    );
  },
  // Basic styling for paragraphs and links
  p: ({ node, ...props }) => (
    <p className={styles.markdownParagraph} {...props} />
  ),
  a: ({ node, ...props }) => (
    <a
      className={styles.markdownLink}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  // Ensure other elements like ul, ol, li, blockquote have basic styling if needed
  // Example:
  // ul: ({ node, ...props }) => <ul className={styles.markdownList} {...props} />,
  // ol: ({ node, ...props }) => <ol className={styles.markdownList} {...props} />,
  // li: ({ node, ...props }) => <li className={styles.markdownListItem} {...props} />,
  // blockquote: ({ node, ...props }) => <blockquote className={styles.markdownBlockquote} {...props} />,
};

// --- Helper Function to Parse <think> Tags and Render Segments ---
// Note: This function now returns ReactMarkdown components *without* an outer wrapper,
// as the wrapper is applied in the main renderContent function.
const parseAndRenderThinkTags = (text: string): React.ReactNode[] => {
  const elements: React.ReactNode[] = [];
  const thinkRegex = /<think>(.*?)<\/think>/gs;
  let lastIndex = 0;
  let match;
  let keyCounter = 0;

  while ((match = thinkRegex.exec(text)) !== null) {
    const thinkContent = match[1]?.trim() || "";
    const matchStartIndex = match.index;
    const matchEndIndex = thinkRegex.lastIndex;

    // 1. Add text *before* the match as Markdown
    if (matchStartIndex > lastIndex) {
      const normalText = text.slice(lastIndex, matchStartIndex);
      elements.push(
        <ReactMarkdown
          key={`text-${lastIndex}`}
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
          // NO className here
        >
          {normalText}
        </ReactMarkdown>
      );
    }

    // 2. Add the <think> block as a Collapse, rendering its content as Markdown
    if (thinkContent) {
      const collapseItems: CollapseProps["items"] = [
        {
          key: `panel-${keyCounter}`,
          label: "Thinking Process",
          children: (
            // Render think content using Markdown (inside a div provided by Collapse)
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
              // NO className here
            >
              {thinkContent}
            </ReactMarkdown>
          ),
        },
      ];
      elements.push(
        <Collapse
          key={`think-${keyCounter}`}
          size="small"
          bordered={false}
          className={styles.thinkingBlock} // Style the overall collapse block
          items={collapseItems}
        />
      );
      keyCounter++;
    }

    lastIndex = matchEndIndex;
  }

  // 3. Add remaining text *after* the last match as Markdown
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    elements.push(
      <ReactMarkdown
        key={`text-${lastIndex}`}
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
        // NO className here
      >
        {remainingText}
      </ReactMarkdown>
    );
  }

  // If no matches found, return the original text wrapped in ReactMarkdown
  if (elements.length === 0 && text.length > 0) {
    return [
      <ReactMarkdown
        key="text-only"
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
        // NO className here
      >
        {text}
      </ReactMarkdown>,
    ];
  }

  return elements;
};

// --- MessageBubble Component ---
const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const { sender, text, isLoading, isError, timestamp } = message;
  const isUser = sender === "user";

  // Format timestamp (optional)
  const formattedTime = useMemo(() => {
    return timestamp
      ? new Date(timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false, // Use 24-hour format, or true for AM/PM
        })
      : "";
  }, [timestamp]);

  // --- Render Content Logic ---
  const renderContent = (): React.ReactNode => {
    // 1. Loading State
    if (isLoading && !isUser) {
      return (
        <div className={styles.loadingContainer}>
          <Spin size="small" />
        </div>
      );
    }

    // 2. Error State
    if (isError && !isUser) {
      const errorText = text || "An unknown error occurred.";
      return (
        <Alert
          message="Error generating response"
          description={errorText}
          type="error"
          showIcon
          className={styles.errorAlert}
        />
      );
    }

    // Ensure text is a string, default to empty string if null/undefined
    const messageText = text || "";

    // 3. AI Message: Check for <think> tags and parse/render accordingly
    if (!isUser) {
      // If <think> tags exist, parse them and render segments with Markdown
      // Wrap the result of parseAndRenderThinkTags in the styled container
      if (/<think>.*?<\/think>/gs.test(messageText)) {
        return (
          <div className={styles.parsedContentContainer}>
            {parseAndRenderThinkTags(messageText)}
          </div>
        );
      } else {
        // If no <think> tags, render the whole AI message as Markdown
        // *** MODIFICATION HERE: Wrap ReactMarkdown in a div ***
        return (
          <div className={styles.markdownContent}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
              // NO className prop here
            >
              {messageText}
            </ReactMarkdown>
          </div>
        );
      }
    }

    // 4. User Message: Render as Markdown (no <think> parsing needed)
    // *** MODIFICATION HERE: Wrap ReactMarkdown in a div ***
    return (
      <div className={styles.markdownContent}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
          // NO className prop here
        >
          {messageText}
        </ReactMarkdown>
      </div>
    );
  };

  return (
    <div
      className={`${styles.bubbleContainer} ${
        isUser ? styles.userContainer : styles.aiContainer
      }`}
    >
      <Avatar
        size={32}
        icon={isUser ? <UserOutlined /> : <RobotOutlined />}
        className={`${styles.avatar} ${
          isUser ? styles.userAvatar : styles.aiAvatar
        }`}
      />
      <div className={styles.messageContentWrapper}>
        <div
          className={`${styles.bubble} ${
            isUser ? styles.userBubble : styles.aiBubble
          }`}
        >
          {renderContent()}
        </div>
        {/* Timestamp */}
        {!isLoading && formattedTime && (
          <div className={styles.timestamp}>{formattedTime}</div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
