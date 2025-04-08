// src/components/CustomCodeBlock/CustomCodeBlock.tsx
import React, { useState, useCallback, useRef, useEffect } from "react";
import { Button, Tooltip, message } from "antd";
import { CopyOutlined, CheckOutlined } from "@ant-design/icons";
import { writeText } from "@tauri-apps/plugin-clipboard-manager"; // Use Tauri clipboard plugin

// Syntax Highlighter - using Prism with a dark theme as example
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
// Choose a style: e.g., oneDark, atomDark, dracula, coy, okaidia, solarizedlight, tomorrow, twilight etc.
// Find more styles here: https://github.com/react-syntax-highlighter/react-syntax-highlighter/blob/master/AVAILABLE_STYLES_PRISM.MD
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"; // ESM import for Vite

import styles from "./CustomCodeBlock.module.css"; // Create this CSS Module

// Props provided by react-markdown `code` component override
interface CustomCodeBlockProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node?: any; // AST node, usually not needed directly
  inline?: boolean; // Is this an inline code block? We usually handle only block code here.
  className?: string; // Contains language-xxx if specified
  children?: React.ReactNode; // Raw code string is usually the first child
  // Allow any other props passed down by react-markdown or parent components
  [key: string]: any;
  // Explicitly define `value` and `language` if passed directly (like in our MessageBubble example)
  value?: string;
  language?: string;
}

const CustomCodeBlock: React.FC<CustomCodeBlockProps> = ({
  inline,
  className,
  children,
  value: propValue, // Value passed directly takes precedence
  language: propLanguage, // Language passed directly takes precedence
  ...props // Pass rest of the props to the underlying element (SyntaxHighlighter)
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Determine language and code content
  const match = /language-(\w+)/.exec(className || "");
  const language = propLanguage ?? match?.[1] ?? "text"; // Use prop, fallback to className, then default to 'text'
  // Prefer direct 'value' prop, fallback to extracting from children
  // Ensure children is treated as a string, trim whitespace/newlines if necessary
  const code = propValue ?? String(children).replace(/^\n+|\n+$/g, ""); // Trim leading/trailing newlines

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (isCopied) return; // Prevent multi-clicks while timeout is active

    try {
      await writeText(code); // Use Tauri API
      message.success("Code copied to clipboard!", 1.5);
      setIsCopied(true);
      // Clear previous timeout if exists
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      // Set new timeout
      copyTimeoutRef.current = setTimeout(() => {
        setIsCopied(false);
        copyTimeoutRef.current = null; // Clear ref after timeout expires
      }, 2000); // Reset icon after 2 seconds
    } catch (err) {
      console.error("Failed to copy code:", err);
      message.error("Failed to copy code", 1.5);
      setIsCopied(false); // Ensure state is reset on error
      if (copyTimeoutRef.current) {
        // Clear timeout on error too
        clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = null;
      }
    }
  }, [code, isCopied]); // Depend on code and isCopied state

  // Render nothing for inline code (should be handled by `<code>` in MessageBubble)
  if (inline) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return (
    <div className={styles.codeBlockContainer}>
      {/* Position the button container absolutely */}
      <div className={styles.buttonContainer}>
        <span className={styles.languageLabel}>
          {language !== "text" ? language : ""}
        </span>
        <Tooltip title={isCopied ? "Copied!" : "Copy code"}>
          <Button
            type="text" // Use text button for subtle look
            icon={isCopied ? <CheckOutlined /> : <CopyOutlined />}
            onClick={handleCopy}
            size="small"
            className={styles.copyButton}
            aria-label="Copy code to clipboard"
          />
        </Tooltip>
      </div>
      <SyntaxHighlighter
        {...props} // Pass down any remaining props
        style={oneDark} // Apply the chosen theme
        language={language}
        PreTag="div" // Use div instead of pre if highlighter adds its own pre, or keep pre if needed
        // wrapLongLines={true} // Optional: wrap long lines instead of horizontal scroll
        customStyle={{
          margin: 0, // Remove default margins from highlighter if any
          padding: "1em", // Add internal padding
          paddingTop: "2.5em", // Add more top padding to accommodate the button/label
          borderRadius: "4px", // Match container rounding
          overflowX: "auto", // Ensure horizontal scroll for long lines
        }}
        // CodeTagProps is crucial if PreTag is 'div' to style the inner `code` tag if needed
        // codeTagProps={{ style: { fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace' } }}
      >
        {code /* Pass the cleaned code string */}
      </SyntaxHighlighter>
    </div>
  );
};

export default CustomCodeBlock;
