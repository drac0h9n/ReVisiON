import React, { useState, useCallback } from "react";
// 导入刚才创建的 CSS 文件
import "./query.css";
// 导入 Tauri API (如果需要与后端交互，暂时注释掉)
// import { invoke } from '@tauri-apps/api/core'; // Tauri v2
// import { getCurrent } from '@tauri-apps/api/window'; // 用于获取当前窗口

const QueryComponent: React.FC = () => {
  // 使用 useState 来管理输入框的值
  const [inputValue, setInputValue] = useState<string>("");
  // 使用 useState 来显示一些反馈信息
  const [feedback, setFeedback] = useState<string>("");

  // 处理输入框内容变化
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
    // 输入时清除反馈信息
    if (feedback) {
      setFeedback("");
    }
  };

  // 处理按钮点击事件
  const handleSearchClick = useCallback(async () => {
    if (!inputValue.trim()) {
      setFeedback("Please enter something to search.");
      return;
    }

    setFeedback(`Searching for: "${inputValue}"...`);
    console.log("Search initiated for:", inputValue);

    // --- 在这里添加与 Tauri 后端交互的逻辑 ---
    try {
      // 示例：调用一个名为 'perform_screenshot_search' 的后端命令
      // const results = await invoke<string[]>('perform_screenshot_search', { query: inputValue });
      // console.log('Search results:', results);
      // setFeedback(`Found ${results.length} results.`);

      // 模拟一个延迟，假装在搜索
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setFeedback(`Search complete for: "${inputValue}" (Placeholder)`);

      // 可选：操作当前窗口，例如搜索完成后关闭
      // const appWindow = await getCurrent();
      // await appWindow.close();
    } catch (error) {
      console.error("Error during search:", error);
      setFeedback(`Error searching: ${error}`);
    }
    // ------------------------------------------
  }, [inputValue]); // 依赖 inputValue，当它变化时重新创建回调

  // 处理在输入框按 Enter 键
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      handleSearchClick();
    }
  };

  return (
    <div className="query-container">
      <h1 className="query-title">Screenshot Query</h1>
      <input
        type="text"
        className="query-input"
        placeholder="Enter search term..."
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown} // 添加键盘事件监听
        autoFocus // 窗口打开时自动聚焦输入框
      />
      <button className="query-button" onClick={handleSearchClick}>
        Search
      </button>
      {/* 显示反馈信息 */}
      {feedback && <p className="query-feedback">{feedback}</p>}
    </div>
  );
};

export default QueryComponent;
