// src/components/MessageBubble/MessageBubble.tsx
import React from "react";
import { Avatar, Spin, Alert } from "antd";
import { UserOutlined, RobotOutlined } from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Import types and components
import { ChatMessage } from "@/types/chat";
import CustomCodeBlock from "@/components/CustomCodeBlock/CustomCodeBlock"; // This dependency is crucial

import styles from "./MessageBubble.module.css"; // We'll create this CSS Module

interface MessageBubbleProps {
  message: ChatMessage;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const { sender, text, isLoading, isError, timestamp } = message;
  const isUser = sender === "user";

  // Format timestamp (optional)
  const formattedTime = new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false, // Use 24-hour format, or true for AM/PM
  });

  return (
    <div
      className={`${styles.bubbleContainer} ${
        isUser ? styles.userContainer : styles.aiContainer
      }`}
    >
      <Avatar
        size={32} // Adjust size as needed
        icon={isUser ? <UserOutlined /> : <RobotOutlined />}
        className={styles.avatar}
      />
      <div className={styles.messageContent}>
        <div
          className={`${styles.bubble} ${
            isUser ? styles.userBubble : styles.aiBubble
          }`}
        >
          {/* Loading Indicator (for AI messages) */}
          {isLoading && !isUser && (
            <div className={styles.loadingContainer}>
              <Spin size="small" />
            </div>
          )}

          {/* Error Indicator (for AI messages) */}
          {isError && !isUser && !isLoading && (
            <Alert
              message="Error generating response"
              type="error"
              showIcon
              className={styles.errorAlert}
              description={text || "An unknown error occurred."} // Show error text from message if available
            />
          )}

          {/* Main Text Content (Markdown Rendered) */}
          {/* Render text only if not loading and not an error (unless error has text) */}
          {((!isLoading && !isError) || (isError && text)) && (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Custom renderer for code blocks
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                code(props) {
                  const { children, className, node, ref, ...rest } = props; // Include ref
                  const match = /language-(\w+)/.exec(className || "");
                  const codeValue = String(children).replace(/\n$/, ""); // Clean trailing newline

                  return match ? (
                    <CustomCodeBlock
                      {...rest} // Pass down other props potentially needed by CustomCodeBlock or its children
                      language={match[1]}
                      value={codeValue}
                      // Pass the `node` prop if CustomCodeBlock needs it for ast manipulation (unlikely here)
                      // node={node}
                      // Do NOT pass down `children` directly if value is used
                    />
                  ) : (
                    // Fallback for inline code or code without language specified
                    <code
                      className={`${className} ${styles.inlineCode}`}
                      {...rest}
                    >
                      {children}
                    </code>
                  );
                },
                // Optional: Style paragraphs, links, etc. if needed
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
              }}
            >
              {/* Render text for user messages, or non-error/non-loading AI messages */}
              {text}
            </ReactMarkdown>
          )}
        </div>
        {/* Timestamp (Optional) */}
        <div className={styles.timestamp}>{formattedTime}</div>
      </div>
    </div>
  );
};

export default MessageBubble;
