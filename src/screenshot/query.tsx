//src/screenshot/query.tsx:

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Image, message, Input, Button } from "antd";
import { SendOutlined } from "@ant-design/icons";
import { convertFileSrc, invoke } from "@tauri-apps/api/core"; // <-- Import invoke
import { listen } from "@tauri-apps/api/event";
import { v4 as uuidv4 } from "uuid";

import { ChatMessage } from "@/types/chat";
import MessageBubble from "@/components/MessageBubble/MessageBubble"; // Ensure this path is correct

import "./query.css";

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

  const chatAreaRef = useRef<HTMLDivElement>(null);

  const processScreenshotPath = useCallback(async (path: string | null) => {
    /* ... as before ... */
    if (path) {
      try {
        // IMPORTANT: Convert path for display *only*. Pass raw path to backend.
        const assetUrl = await convertFileSrc(path);
        console.log(
          `[QueryPage] Converted path "${path}" to asset URL "${assetUrl}" for display.`
        );
        setScreenshotAssetUrl(assetUrl);
        setRawScreenshotPath(path); // Store the original path
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
      // message.warning("未提供截图或加载失败"); // Optional: less noisy
    }
  }, []);

  // --- Effect 1: Handle initial screenshot ---
  useEffect(() => {
    /* ... as before ... */
    console.log("[QueryPage] Checking for initial screenshot...");
    if (window.__INITIAL_SCREENSHOT_PATH__ !== undefined) {
      const initialPath = window.__INITIAL_SCREENSHOT_PATH__;
      console.log(`[QueryPage] Found initial path: ${initialPath}`);
      // Use a timeout of 0 to ensure state updates happen *after* initial render cycle
      // This can sometimes help with race conditions in React/Tauri initialization
      setTimeout(() => processScreenshotPath(initialPath), 0);
      delete window.__INITIAL_SCREENSHOT_PATH__;
    } else {
      console.log("[QueryPage] No initial screenshot path found.");
    }
  }, [processScreenshotPath]);

  // --- Effect 2: Listen for new screenshots ---
  useEffect(() => {
    /* ... as before ... */
    console.log("[QueryPage] Setting up 'new_screenshot' listener...");
    let unlisten: (() => void) | undefined;
    const setupListener = async () => {
      try {
        unlisten = await listen<{ path: string | null }>(
          "new_screenshot",
          (event) => {
            console.log(
              `[QueryPage] Received 'new_screenshot' event:`,
              event.payload
            );
            // Use timeout here as well for consistency
            setTimeout(
              () => processScreenshotPath(event.payload?.path ?? null),
              0
            );
          }
        );
        console.log("[QueryPage] Listener attached.");
      } catch (error) {
        console.error("[QueryPage] Failed setup listener:", error);
        message.error("无法监听新的截图事件");
      }
    };
    setupListener();
    return () => {
      console.log("[QueryPage] Cleaning up listener...");
      unlisten?.();
      console.log("[QueryPage] Listener detached.");
    };
  }, [processScreenshotPath]);

  // --- Effect 3: Auto-scroll ---
  useEffect(() => {
    /* ... as before ... */
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, [messages]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
  };

  // --- Send Message Handler (UPDATED LOGIC) ---
  const handleSendMessage = useCallback(async () => {
    const trimmedInput = inputValue.trim();
    if (!trimmedInput && !rawScreenshotPath) {
      // Prevent sending if both text and image are missing
      message.warning("Please enter text or provide a screenshot.");
      return;
    }
    if (isLoadingAI) return; // Prevent double sending

    const newUserMessage: ChatMessage = {
      id: uuidv4(),
      sender: "user",
      text: trimmedInput || "(Query related to image)", // Add placeholder if text is empty but image exists
      timestamp: Date.now(),
      // imageAssetUrl is removed if modifying ChatMessage type
    };

    const aiLoadingMessage: ChatMessage = {
      id: uuidv4(),
      sender: "ai",
      text: "",
      timestamp: Date.now(),
      isLoading: true,
    };

    // Add user message and AI loading placeholder immediately
    setMessages((prev) => [...prev, newUserMessage, aiLoadingMessage]);
    setInputValue("");
    setIsLoadingAI(true); // Set loading state

    console.log(
      "[QueryPage] Sending to backend. Query:",
      trimmedInput,
      "Screenshot Path:",
      rawScreenshotPath ?? "None"
    );

    try {
      // *** Call the Tauri command ***
      const aiTextResponse = await invoke<string>("send_query_to_worker", {
        text: trimmedInput, // Pass the text query
        imagePath: rawScreenshotPath, // Pass the RAW file path or null
      });
      console.log(
        "[QueryPage] Received AI response from backend:",
        aiTextResponse
      );

      // Update the AI loading message with the actual successful response
      setMessages((prev) =>
        prev.map(
          (msg) =>
            msg.id === aiLoadingMessage.id
              ? {
                  ...msg, // Spread the existing message properties (id, sender, timestamp)
                  text: aiTextResponse, // Update the text
                  isLoading: false, // Set loading to false
                  isError: false, // Set error to false
                }
              : msg // Keep other messages as they are
        )
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        "[QueryPage] Error invoking send_query_to_worker:",
        errorMessage
      );
      message.error(`Failed to get AI response: ${errorMessage}`); // Show error to user

      // Update the AI loading message with the error state
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiLoadingMessage.id
            ? {
                ...msg,
                text: `Error: ${errorMessage}`, // Show error in bubble
                isLoading: false, // Set loading to false
                isError: true, // Set error to true
              }
            : msg
        )
      );
    } finally {
      setIsLoadingAI(false); // Ensure loading state is cleared regardless of success/failure
    }
  }, [inputValue, rawScreenshotPath, isLoadingAI]); // Include isLoadingAI in dependencies

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="query-page-container">
      <div className="chat-area" ref={chatAreaRef}>
        {/* Initial Prompts */}
        {messages.length === 0 && screenshotAssetUrl && (
          <div className="initial-prompt">
            <p>Screenshot loaded. Ask me anything about it!</p>
          </div>
        )}
        {messages.length === 0 && !screenshotAssetUrl && (
          <div className="initial-prompt">
            <p>
              {" "}
              Press CmdOrCtrl+Shift+Q to capture a screenshot, or ask a general
              question.
            </p>
          </div>
        )}
        {/* Render Messages */}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} /> // Use the updated MessageBubble
        ))}
      </div>

      <div className="input-area">
        {/* Screenshot Thumbnail */}
        {screenshotAssetUrl && (
          <div className="thumbnail-container">
            <Image
              src={screenshotAssetUrl} // Use asset URL for display
              alt="Screenshot Thumbnail"
              className="screenshot-thumbnail"
              preview={{
                visible: isPreviewVisible,
                onVisibleChange: setIsPreviewVisible,
                src: screenshotAssetUrl, // Preview uses asset URL
              }}
              onClick={() => setIsPreviewVisible(true)}
              rootClassName="thumbnail-antd-image"
            />
            {/* AntD's hidden image for preview functionality */}
            <Image
              width={0}
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
        {/* Text Input */}
        <Input.TextArea
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            rawScreenshotPath
              ? "Ask about the screenshot..."
              : "Ask anything..."
          }
          autoSize={{ minRows: 1, maxRows: 4 }}
          className="chat-input"
          disabled={isLoadingAI}
        />
        {/* Send Button */}
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSendMessage}
          loading={isLoadingAI}
          // Disable button if AI is loading OR if there's no text AND no image
          disabled={isLoadingAI || (!inputValue.trim() && !rawScreenshotPath)}
          className="send-button"
        />
      </div>
    </div>
  );
};

export default QueryPage;
