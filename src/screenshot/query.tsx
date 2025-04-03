// src/screenshot/query.tsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Image, message, Input, Button } from "antd"; // <-- Import Ant Design components
import { SendOutlined } from "@ant-design/icons";
import { convertFileSrc } from "@tauri-apps/api/core"; // <-- Import convertFileSrc
import { listen } from "@tauri-apps/api/event"; // <-- Import listen
import { v4 as uuidv4 } from "uuid"; // For generating unique message IDs

// Import types and new components (assuming paths)
import { ChatMessage } from "@/types/chat";
import MessageBubble from "@/components/MessageBubble/MessageBubble";

import "./query.css"; // <-- Import CSS

// Extend window type for the initial path
declare global {
  interface Window {
    __INITIAL_SCREENSHOT_PATH__?: string | null;
  }
}

const QueryPage: React.FC = () => {
  const [screenshotAssetUrl, setScreenshotAssetUrl] = useState<string | null>(
    null
  );
  const [rawScreenshotPath, setRawScreenshotPath] = useState<string | null>(
    null
  );
  const [isPreviewVisible, setIsPreviewVisible] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState<string>("");
  const [isLoadingAI, setIsLoadingAI] = useState<boolean>(false);

  const chatAreaRef = useRef<HTMLDivElement>(null); // Ref for scrolling chat

  // --- Function to process a new screenshot path ---
  const processScreenshotPath = useCallback(async (path: string | null) => {
    if (path) {
      try {
        const assetUrl = await convertFileSrc(path);
        console.log(
          `[QueryPage] Converted path "${path}" to asset URL "${assetUrl}"`
        );
        setScreenshotAssetUrl(assetUrl);
        setRawScreenshotPath(path);
        // Optional: add an initial system message?
        // setMessages(prev => [...prev, { id: uuidv4(), sender: 'ai', text: "Screenshot loaded.", timestamp: Date.now() }]);
      } catch (error) {
        console.error("[QueryPage] Error converting file src:", error);
        message.error("无法加载截图预览");
        setScreenshotAssetUrl(null);
        setRawScreenshotPath(null);
      }
    } else {
      console.log("[QueryPage] Received null path, clearing screenshot.");
      setScreenshotAssetUrl(null);
      setRawScreenshotPath(null);
      message.warning("未提供截图或加载失败");
    }
  }, []);

  // --- Effect 1: Handle initial screenshot passed via script ---
  useEffect(() => {
    console.log(
      "[QueryPage] Component mounted, checking for initial screenshot..."
    );
    if (window.__INITIAL_SCREENSHOT_PATH__ !== undefined) {
      const initialPath = window.__INITIAL_SCREENSHOT_PATH__;
      console.log(`[QueryPage] Found initial path: ${initialPath}`);
      processScreenshotPath(initialPath);
      // Clear it to prevent reprocessing on potential future updates/remounts
      delete window.__INITIAL_SCREENSHOT_PATH__;
    } else {
      console.log(
        "[QueryPage] No initial screenshot path found on window object."
      );
    }
  }, [processScreenshotPath]); // Depend on processScreenshotPath

  // --- Effect 2: Listen for new screenshots from App.tsx ---
  useEffect(() => {
    console.log("[QueryPage] Setting up 'new_screenshot' event listener...");
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlisten = await listen<{ path: string | null }>(
          "new_screenshot",
          (event) => {
            console.log(
              `[QueryPage] Received 'new_screenshot' event with payload:`,
              event.payload
            );
            processScreenshotPath(event.payload?.path ?? null); // Handle potential null path in event
          }
        );
        console.log(
          "[QueryPage] 'new_screenshot' event listener attached successfully."
        );
      } catch (error) {
        console.error("[QueryPage] Failed to setup event listener:", error);
        message.error("无法监听新的截图事件");
      }
    };

    setupListener();

    // Cleanup function
    return () => {
      console.log("[QueryPage] Cleaning up 'new_screenshot' event listener...");
      if (unlisten) {
        unlisten();
        console.log("[QueryPage] 'new_screenshot' event listener detached.");
      } else {
        console.log("[QueryPage] No event listener function found to detach.");
      }
    };
  }, [processScreenshotPath]); // Depend on processScreenshotPath

  // --- Effect 3: Auto-scroll chat area ---
  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, [messages]); // Scroll whenever messages change

  // --- Input Change Handler ---
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
  };

  // --- Send Message Handler (Placeholder AI Logic) ---
  const handleSendMessage = useCallback(async () => {
    const trimmedInput = inputValue.trim();
    if (!trimmedInput) return;

    const newUserMessage: ChatMessage = {
      id: uuidv4(),
      sender: "user",
      text: trimmedInput,
      imageAssetUrl: messages.length === 0 ? screenshotAssetUrl : undefined, // Attach screenshot only to the first user message potentially
      timestamp: Date.now(),
    };

    const aiLoadingMessage: ChatMessage = {
      id: uuidv4(),
      sender: "ai",
      text: "", // Initially empty
      timestamp: Date.now(),
      isLoading: true,
    };

    setMessages((prev) => [...prev, newUserMessage, aiLoadingMessage]);
    setInputValue("");
    setIsLoadingAI(true);

    console.log(
      "[QueryPage] Sending message (simulation)... Query:",
      trimmedInput,
      "Screenshot:",
      rawScreenshotPath ?? "None"
    );

    // **--- Placeholder for actual AI call ---**
    // Replace this setTimeout with your actual API call
    await new Promise((resolve) => setTimeout(resolve, 1500)); // Simulate network delay

    // Simulate response
    const aiResponseMessage: Partial<ChatMessage> = {
      // Partial because we update an existing entry
      text: `AI response to "${trimmedInput}". ${
        rawScreenshotPath ? "I see the screenshot." : "No screenshot provided."
      }`,
      isLoading: false,
      isError: false, // Set to true on actual API error
    };

    // Update the specific AI loading message
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === aiLoadingMessage.id ? { ...msg, ...aiResponseMessage } : msg
      )
    );
    // **--- End Placeholder ---**

    setIsLoadingAI(false);
  }, [inputValue, rawScreenshotPath, screenshotAssetUrl, messages.length]); // Include dependencies

  // Handle Enter press in TextArea (Shift+Enter for newline)
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault(); // Prevent default newline insertion
      handleSendMessage();
    }
  };

  return (
    <div className="query-page-container">
      {/* Optional Header */}
      {/* <div className="query-page-header">Query</div> */}

      {/* Chat Area */}
      <div className="chat-area" ref={chatAreaRef}>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {/* Show initial placeholder if no messages and screenshot exists? */}
        {messages.length === 0 && screenshotAssetUrl && (
          <div className="initial-prompt">
            <p>Screenshot loaded. Ask me anything about it!</p>
          </div>
        )}
        {messages.length === 0 && !screenshotAssetUrl && (
          <div className="initial-prompt">
            <p>
              No screenshot loaded. Press CmdOrCtrl+Shift+Q to capture one, or
              just ask a general question.
            </p>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="input-area">
        {/* Screenshot Thumbnail */}
        {screenshotAssetUrl && (
          <div className="thumbnail-container">
            <Image
              src={screenshotAssetUrl}
              alt="Screenshot Thumbnail"
              className="screenshot-thumbnail"
              preview={{
                visible: isPreviewVisible,
                onVisibleChange: setIsPreviewVisible,
                src: screenshotAssetUrl, // Ensure preview uses the correct source
              }}
              onClick={() => setIsPreviewVisible(true)} // Click thumb to open preview
              // The AntD Image component with preview doesn't need the separate preview logic,
              // but we keep the 'display: none' structure from the docs just in case.
              // Style the basic image element if needed, preview handles the rest.
              rootClassName="thumbnail-antd-image" // Use rootClassName for wrapper styles if needed
            />
            {/* This hidden image is the standard way AntD handles preview triggering */}
            <Image
              width={0} // Effectively hidden
              height={0}
              src={screenshotAssetUrl}
              preview={{
                visible: isPreviewVisible,
                src: screenshotAssetUrl,
                onVisibleChange: (vis) => setIsPreviewVisible(vis),
              }}
              style={{ display: "none" }}
            />
          </div>
        )}

        <Input.TextArea
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown} // Use onKeyDown for Enter press
          placeholder="Ask about the screenshot or anything else..."
          autoSize={{ minRows: 1, maxRows: 4 }}
          className="chat-input"
          disabled={isLoadingAI}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSendMessage}
          loading={isLoadingAI}
          disabled={!inputValue.trim()}
          className="send-button"
        />
      </div>
    </div>
  );
};

export default QueryPage;
