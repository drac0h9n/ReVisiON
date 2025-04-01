我希望你根据当前代码以及下面的开发文档，实现开发目标。过程中涉及的所有代码完整的发给我。

开发目标：我希望用户在按下快捷键后会截图整个屏幕，截图的缩略图会出现在 Query Page(很小的缩略图)，用户点击后可以跟 ScreenShotPage 一样放大进行 Preview

## **项目技术栈:** Tauri 2.0 + React + TypeScript + npm + Vite + Zustand + Cloudflare Worker + Ant Design

### 文档 1: 现有文件修改

**项目:** Tauri Query Page 功能开发
**目标:** 修改现有文件以支持 Query Page 的截图显示和聊天界面功能。
**涉及功能点:** 1 (部分), 2
**负责人:** [开发者姓名]

#### 1. `src/App.tsx` - 快捷键处理与截图触发

**目标:** 修改 `CmdOrCtrl+Shift+Q` 快捷键的回调逻辑，使其在打开/聚焦 Query Window 前先执行截图，并将截图路径传递给目标窗口。

**修改步骤:**

1.  **导入所需 API:**

    - `@tauri-apps/plugin-screenshots-api`: `getPrimaryMonitorScreenshot`, `getScreenshotableMonitors` (如果需要选择或备用).
    - `@tauri-apps/plugin-macos-permissions-api`: `checkScreenRecordingPermission` (macOS specific, consider platform check if cross-platform).
    - `@tauri-apps/api/webviewWindow`: `WebviewWindow`, `getAllWebviewWindows`, `emitTo`.
    - `@tauri-apps/api/core`: `convertFileSrc` (可能不需要在此文件, 但 Query Page 会用).
    - Ant Design `message` for user feedback.

2.  **修改 `openOrFocusQueryWindow` 函数 (或创建一个新的回调函数):**
    - **入口:** 在 `isProcessingHotkeyRef.current` 检查之后，函数开始时。
    - **权限检查:**
      - 调用 `checkScreenRecordingPermission()`.
      - 如果返回 `false`, 显示错误消息 (`message.error`) 提示用户需要权限，并 `return` 提前结束函数执行。记录日志。
      - 如果检查出错，也应处理并 `return`.
    - **执行截图:**
      - 调用 `getPrimaryMonitorScreenshot()` (或更复杂的逻辑获取特定屏幕)。
      - 使用 `try...catch` 包裹截图调用。
      - **成功:** 获取返回的 `filePath` (字符串)。
      - **失败:** 捕获错误，显示错误消息 (`message.error`)，记录日志，并 `return` 提前结束。
    - **窗口处理:**
      - 查找或创建 `screenshot_query_window` (现有逻辑)。
      - **传递截图路径:**
        - **创建新窗口时:**
          - 在 `new WebviewWindow(QUERY_WINDOW_LABEL, { ... })` 的 `options` 中添加 `initializationScript`。
          - `initializationScript`: `window.__INITIAL_SCREENSHOT_PATH__ = "${filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}";` (确保路径字符串正确转义)。
          ```typescript
          // Example within new WebviewWindow options:
          initializationScript: `window.__INITIAL_SCREENSHOT_PATH__ = "${filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}";`,
          url: QUERY_WINDOW_URL, // Keep URL for base HTML loading
          // ... other options
          ```
        - **聚焦现有窗口时:**
          - 在调用 `existingWindow.setFocus()` 之后。
          - 调用 `emitTo(QUERY_WINDOW_LABEL, 'new_screenshot', { path: filePath });` 向目标窗口发送事件。
          ```typescript
          // Example after focusing existing window:
          await existingWindow.setFocus();
          console.log(
            `[Hotkey] Emitting 'new_screenshot' event to window "${QUERY_WINDOW_LABEL}"`
          );
          await emitTo(QUERY_WINDOW_LABEL, "new_screenshot", {
            path: filePath,
          });
          message.info("查询窗口已聚焦并更新截图", 1.5);
          ```
    - **完善错误处理和日志:** 在权限检查、截图、窗口操作的各个环节添加详细的 `console.log` 和 `console.error`。
    - **状态管理:** 确保 `isProcessingHotkeyRef` 在整个流程（包括截图）完成或出错后正确设置为 `false`。

**预期结果:** 按下快捷键后，应用会检查权限，执行截图，然后打开或聚焦 Query Window，并将截图路径可靠地传递给该窗口的前端。

#### 2. `src/screenshot/query.tsx` - Query Page 核心实现 (重大修改)

**目标:** 将此文件从占位符转变为功能完善的 Query Page 组件，负责接收截图、显示缩略图/预览、渲染聊天记录（含 Markdown 和代码复制）。

**修改步骤:**

1.  **组件结构与 State:**

    - 引入 `React`, `useState`, `useEffect`, `useCallback`。
    - 引入 Tauri API: `@tauri-apps/api/core::convertFileSrc`, `@tauri-apps/api/event::listen`, `@tauri-apps/plugin-clipboard-manager` (可选, 用于复制).
    - 引入 Ant Design: `Image`, `Spin`, `message`, `Input`, `Button`, etc.
    - 引入 Markdown 库: `react-markdown`, `remark-gfm`.
    - 引入自定义组件: `MessageBubble`, `CustomCodeBlock` (将在文档 2 中定义)。
    - **定义 State:**
      - `screenshotAssetUrl: string | null`: 用于 `<img>` src 的 `asset://` URL。
      - `rawScreenshotPath: string | null`: 原始文件路径 (可能用于后续发送)。
      - `isPreviewVisible: boolean`: 控制 AntD `Image` 预览。
      - `messages: ChatMessage[]`: 聊天记录数组 (需定义 `ChatMessage` 接口，见设计文档)。
      - `inputValue: string`: 聊天输入框内容。
      - `isLoadingAI: boolean`: AI 是否正在回复。

2.  **处理截图 (功能点 1):**

    - **Effect 1: 初始加载:**
      - `useEffect(() => { ... }, [])` (空依赖数组，仅运行一次)。
      - 检查 `window.__INITIAL_SCREENSHOT_PATH__` 是否存在。
      - 如果存在，调用 `convertFileSrc` 转换路径。
      - 更新 `screenshotAssetUrl` 和 `rawScreenshotPath` state。
      - 清除 `window.__INITIAL_SCREENSHOT_PATH__` (可选，防止重复处理)。
    - **Effect 2: 事件监听:**
      - `useEffect(() => { ... }, [])` (空依赖数组，挂载时监听)。
      - 调用 `listen<{ path: string }>('new_screenshot', async (event) => { ... })`。
      - 在回调中，获取 `event.payload.path`。
      - 调用 `convertFileSrc` 转换路径。
      - 更新 `screenshotAssetUrl` 和 `rawScreenshotPath` state。
      - 返回 `unlisten` 函数用于组件卸载时清理监听器。

3.  **UI 渲染 (功能点 1 & 2):**

    - **整体布局:** 使用 Flexbox 或 Grid 组织布局：
      - 可选的 Header/Title。
      - 截图缩略图区域 (固定位置，例如输入框旁或上方)。
      - 可滚动的聊天记录区域。
      - 固定的底部输入区域。
    - **截图缩略图:**
      - 使用 `<img src={screenshotAssetUrl} ... />` 显示缩略图 (如果 `screenshotAssetUrl` 不为 null)。
      - 添加 CSS 限制其最大尺寸(`max-width`, `max-height`)。
      - 添加 `onClick={() => setIsPreviewVisible(true)}`。
      - 添加 `alt` 文本。
    - **截图预览:**
      - 使用 Ant Design `<Image>` 组件进行预览。
      - `<Image preview={{ visible: isPreviewVisible, src: screenshotAssetUrl, onVisibleChange: setIsPreviewVisible }} style={{ display: 'none' }} />` (初始隐藏，仅用于触发预览)。
    - **聊天记录:**
      - 映射 `messages` state: `messages.map(msg => <MessageBubble key={msg.id} message={msg} />)`.
      - 需要一个可以滚动的容器 (`div` with `overflow-y: auto`)。实现自动滚动到底部 (使用 `useRef` 和 `useEffect` 监听 `messages` 变化)。
    - **输入区域:**
      - 使用 Ant Design `<Input.TextArea value={inputValue} onChange={...} onPressEnter={...} />`。
      - 使用 Ant Design `<Button onClick={handleSendMessage} loading={isLoadingAI}>Send</Button>`。

4.  **消息处理逻辑 (仅 UI 部分 - 功能点 2):**
    - `handleInputChange`: 更新 `inputValue` state。
    - `handleSendMessage`: (将在 Feature 3 中详细实现)
      - 目前**仅需**模拟添加用户消息和 AI 加载中消息到 `messages` state。
      - 获取 `inputValue` 和 `screenshotAssetUrl` (用于用户消息气泡内的小图)。
      - 构建 `ChatMessage` 对象 (user)。
      - 构建 `ChatMessage` 对象 (ai, `isLoading: true`)。
      - 更新 `messages` state。
      - 清空 `inputValue`。
      - 设置 `isLoadingAI = true`。
      - (模拟 AI 回复: 可以用 `setTimeout` 稍后更新 AI 消息的 `text` 和 `isLoading`)。

**预期结果:** Query Page 能够接收并显示截图缩略图和预览，并提供一个基本的聊天界面布局，可以显示（目前是模拟的）用户消息和 AI 消息。Markdown 和代码复制功能依赖于**文档 2**中定义的子组件。

#### 3. `src/screenshot/query.css` (或 Styled Components/Tailwind)

**目标:** 为 Query Page 提供样式。

**修改/创建内容:**

- **布局样式:** 定义主容器、聊天记录区域、输入区域的尺寸、位置、边距、内边距。
- **滚动条样式:** (可选) 美化聊天记录区域的滚动条。
- **缩略图样式:** 定义截图缩略图的最大尺寸、边框、鼠标指针等。
- **消息气泡样式:** (与 `MessageBubble.tsx` 配合)
  - 用户/AI 气泡的背景色、圆角、最大宽度。
  - 对齐方式 (使用 Flexbox `justify-content` 或 `margin` auto)。
  - 气泡内文字和图片（小缩略图）的排列。
- **代码块样式:** (与 `CustomCodeBlock.tsx` 配合)
  - `pre` 和 `code` 标签的背景色、字体、内边距、溢出处理。
  - 代码复制按钮的定位、外观、hover 效果。

**预期结果:** Query Page 具有符合设计要求的视觉外观和布局。

---

### 文档 2: 新增文件/组件设计

**项目:** Tauri Query Page 功能开发
**目标:** 设计并实现用于 Query Page 聊天界面的新 React 组件。
**涉及功能点:** 2
**负责人:** [开发者姓名]

#### 1. `src/components/MessageBubble/MessageBubble.tsx` (新组件)

**目标:** 渲染单条聊天消息，区分用户和 AI，并处理 Markdown 内容。

**组件接口 (Props):**

```typescript
import { ChatMessage } from "@/types/chat"; // Assuming type defined elsewhere or locally

interface MessageBubbleProps {
  message: ChatMessage;
}
```

**内部逻辑与渲染:**

1.  **导入依赖:** `React`, `ReactMarkdown`, `remarkGfm`, `CustomCodeBlock` (待创建), `ChatMessage` 类型, AntD components (e.g., `Avatar`, `Image` for inline thumbnail).
2.  **判断发送者:** `const isUser = message.sender === 'user';`
3.  **容器样式:** 根据 `isUser` 应用不同的 CSS 类名或内联样式，控制对齐 (e.g., `justify-content: flex-end` for user) 和背景色。
4.  **头像 (可选):** 可以考虑根据 `sender` 显示不同的头像 (用户头像可从 `authStore` 获取，AI 用固定图标)。
5.  **内容区域:**
    - **气泡样式:** 应用背景色、圆角、内边距。
    - **图片缩略图 (用户消息):** 如果 `isUser` 且 `message.imageAssetUrl` 存在，在文本上方或旁边渲染一个小的 `<Image src={message.imageAssetUrl} ... />`。
    - **文本内容:**
      - 使用 `<ReactMarkdown>` 组件渲染 `message.text`。
      - 传入 `remarkPlugins={[remarkGfm]}`。
      - 传入 `components` prop 来覆盖默认的代码块渲染：
        ```jsx
        components={{
          code(props) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { children, className, node, ...rest } = props;
            const match = /language-(\w+)/.exec(className || '');
            // 传递 props 给自定义代码块组件
            return match ? (
                <CustomCodeBlock language={match[1]} value={String(children).replace(/\n$/, '')} {...rest} />
            ) : (
                <code className={className} {...rest}>
                    {children}
                </code>
            );
         },
         // 可选: 覆盖 pre 标签以添加外层容器等
         // pre: ({ node, ...props }) => <div className="markdown-pre-wrapper"><pre {...props} /></div>
        }}
        ```
    - **加载指示器 (AI 消息):** 如果 `!isUser` 且 `message.isLoading`, 显示 AntD `Spin` 或类似加载动画。
    - **错误指示器 (AI 消息):** 如果 `!isUser` 且 `message.isError` (建议在 `ChatMessage` 接口添加此字段), 显示错误图标或特殊样式。
6.  **时间戳 (可选):** 在气泡下方或旁边显示格式化的 `message.timestamp`。

**CSS/样式:** 需要配合的 CSS (`MessageBubble.module.css`或全局) 来定义气泡颜色、对齐、内联图片大小等。

**预期结果:** 一个可复用的组件，能正确显示用户和 AI 的消息气泡，包含文本（Markdown 渲染后）和可选的图片缩略图，并能处理加载和错误状态。

#### 2. `src/components/CustomCodeBlock/CustomCodeBlock.tsx` (新组件)

**目标:** 渲染代码块，提供语法高亮（可选）和一键复制功能。

**组件接口 (Props):** (由 `react-markdown` 传递)

```typescript
interface CustomCodeBlockProps {
  language?: string; // 提取出的语言标识符
  value: string; // 代码字符串
  // ... other props passed down by react-markdown (like inline) - may not be needed
}
```

**内部逻辑与渲染:**

1.  **导入依赖:** `React`, `useState`, `useCallback`, AntD (`Button`, `Tooltip`, `message` 或 `CheckOutlined`, `CopyOutlined` 图标), `@tauri-apps/plugin-clipboard-manager` (推荐) 或 `navigator.clipboard`. Optional: `react-syntax-highlighter` 或其他高亮库。
2.  **状态:**
    - `isCopied: boolean`: 用于显示复制成功的状态 (例如图标变化)。
3.  **复制功能:**
    - `handleCopy`: 使用 `useCallback`.
    - 调用 `clipboard.writeText(value)` (Tauri 插件) 或 `navigator.clipboard.writeText(value)`.
    - 处理 Promise 的 `then` (设置 `isCopied = true`, 显示 `message.success`, 启动定时器将 `isCopied` 复位) 和 `catch` (显示 `message.error`)。
    - 使用 `setTimeout` 在短暂延迟后将 `isCopied` 设置回 `false`。
4.  **渲染:**

    - 最外层 `div` 设置 `position: relative` 以便定位复制按钮。
    - **复制按钮:**
      - 使用 AntD `Button` (类型 `ghost` 或 `text`, size `small`) 或直接用图标。
      - 图标根据 `isCopied` 状态切换 (`CopyOutlined` -> `CheckOutlined`)。
      - 使用 `position: absolute`, `top`, `right` 定位到代码块右上角。
      - 使用 AntD `Tooltip` 提供提示文字 ("Copy code")。
      - 绑定 `onClick={handleCopy}`。
    - **代码区域:**

      - 使用 `pre` 标签包裹。
      - **方式一 (带高亮):** 使用 `react-syntax-highlighter`。

        ```jsx
        import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
        import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"; // Choose a theme

        <SyntaxHighlighter
          language={language || "text"} // Provide a default
          style={oneDark} // Apply theme
          PreTag="div" // Use div instead of pre if highlighter handles it
          // customStyle={{ margin: 0 }} // Reset margin if needed
        >
          {value}
        </SyntaxHighlighter>;
        ```

5.  **CSS/样式:** 需要配合的 CSS (`CustomCodeBlock.module.css` 或全局) 来定义代码块的背景、字体、内边距、溢出处理，以及复制按钮的样式和定位。

**预期结果:** 一个可用于 `react-markdown` 的组件，能显示代码块，并在右上角提供功能正常的复制按钮。

#### 3. `src/types/chat.ts` (新文件或整合到现有类型文件)

**目标:** 定义 `ChatMessage` 接口。

**内容:**

```typescript
export interface ChatMessage {
  id: string; // Unique identifier
  sender: "user" | "ai";
  text: string;
  imageAssetUrl?: string; // Asset URL for the small thumbnail in user message bubble
  timestamp: number;
  isLoading?: boolean; // Indicator for AI response pending
  isError?: boolean; // Indicator for AI response error
}
```

**预期结果:** 提供统一的聊天消息数据结构定义。

```currentCode
src/App.tsx:
// src/App.tsx
import { useEffect, useRef } from "react"; // <-- 引入 useRef
import { Routes, Route } from "react-router-dom";
import { message } from "antd"; // <-- 引入 antd message

// 应用内组件
import GitHubAuth from "@/login/GitHubAuth";
import ScreenshotPage from "@/screenshot/ScreenshotPage";
import { setupTray, cleanupTray } from "@/core/tray";

// Tauri API 和插件
import {
  register,
  unregister,
  isRegistered,
} from "@tauri-apps/plugin-global-shortcut"; // <-- 引入全局快捷键 API
import {
  WebviewWindow,
  getAllWebviewWindows,
} from "@tauri-apps/api/webviewWindow"; // <-- 引入 WebviewWindow API

// 样式
import "./App.css";

// --- 新增常量 ---
const QUERY_HOTKEY = "CmdOrCtrl+Shift+Q"; // 定义查询窗口的快捷键
const QUERY_WINDOW_LABEL = "screenshot_query_window"; // 定义查询窗口的唯一标签
const QUERY_WINDOW_URL = "screenshot_query.html"; // 定义查询窗口加载的 HTML 文件

function App() {
  // --- 新增 Refs ---
  const isRegisteringRef = useRef(false); // 防止并发注册快捷键
  const isProcessingHotkeyRef = useRef(false); // 防止快捷键处理过程中的并发问题

  // --- 新增函数：处理打开或聚焦查询窗口 ---
  const openOrFocusQueryWindow = async () => {
    if (isProcessingHotkeyRef.current) {
      console.warn(`[Hotkey] 操作已在进行中，忽略本次触发。`);
      return;
    }
    isProcessingHotkeyRef.current = true;
    console.log(`[Hotkey] 快捷键 ${QUERY_HOTKEY} 已触发，正在处理...`);

    try {
      // 检查窗口是否已存在
      const allWindows = await getAllWebviewWindows();
      const existingWindow = allWindows.find(
        (win) => win.label === QUERY_WINDOW_LABEL
      );

      if (existingWindow) {
        console.log(`[Hotkey] 窗口 "${QUERY_WINDOW_LABEL}" 已存在，尝试聚焦。`);
        // 如果窗口存在，尝试取消最小化、显示并聚焦
        if (await existingWindow.isMinimized()) {
          await existingWindow.unminimize();
          console.log(`[Hotkey] 窗口 "${QUERY_WINDOW_LABEL}" 已取消最小化。`);
        }
        if (!(await existingWindow.isVisible())) {
          await existingWindow.show();
          console.log(`[Hotkey] 窗口 "${QUERY_WINDOW_LABEL}" 已显示。`);
        }
        await existingWindow.setFocus();
        console.log(`[Hotkey] 窗口 "${QUERY_WINDOW_LABEL}" 已聚焦。`);
        message.info("查询窗口已聚焦", 1.5);
      } else {
        console.log(
          `[Hotkey] 窗口 "${QUERY_WINDOW_LABEL}" 未找到，正在创建新窗口...`
        );
        // 如果窗口不存在，创建新窗口
        const webviewWindow = new WebviewWindow(QUERY_WINDOW_LABEL, {
          url: QUERY_WINDOW_URL, // 加载指定的 HTML 文件
          title: "Screenshot Query", // 设置窗口标题
          width: 450, // 设置初始宽度
          height: 350, // 设置初始高度
          resizable: true, // 允许调整大小
          decorations: true, // 显示窗口装饰（标题栏、边框）
          alwaysOnTop: false, // 默认不置顶
          center: true, // 创建时居中
          focus: true, // 创建后自动获得焦点
          // theme: 'light',            // 可选：强制主题
          // transparent: false,       // 可选：是否透明
        });

        // 监听创建成功事件
        webviewWindow.once("tauri://created", () => {
          console.log(`[Hotkey] 窗口 "${QUERY_WINDOW_LABEL}" 创建成功。`);
          message.success("查询窗口已打开", 1.5);
        });

        // 监听创建错误事件
        webviewWindow.once("tauri://error", (e) => {
          console.error(`[Hotkey] 创建窗口 "${QUERY_WINDOW_LABEL}" 失败:`, e);
          message.error(`打开查询窗口失败: ${e}`);
        });
      }
    } catch (error) {
      console.error("[Hotkey] 处理查询窗口时出错:", error);
      message.error(
        `处理查询窗口时出错: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      isProcessingHotkeyRef.current = false; // 释放处理锁
      console.log(`[Hotkey] 处理逻辑执行完毕。`);
    }
  };

  useEffect(() => {
    console.log("[App.tsx] 组件挂载，开始执行 useEffect...");
    let trayCleanupFunc: (() => void) | null = null;
    let isHotkeyRegisteredInThisEffect = false; // <-- 新增：跟踪快捷键注册状态

    // --- 托盘设置逻辑 (保持不变) ---
    console.log("[App.tsx] 正在调用 setupTray...");
    setupTray()
      .then((unlisten) => {
        console.log("[App.tsx] setupTray Promise 解析成功。");
        if (unlisten && typeof unlisten === "function") {
          trayCleanupFunc = unlisten;
          console.log("[App.tsx] 已收到托盘 unlisten 函数。");
        } else {
          console.warn(
            "[App.tsx] setupTray 已解析但未返回有效的 unlisten 函数。"
          );
        }
      })
      .catch((error) => {
        console.error("[App.tsx] 调用 setupTray 时出错:", error);
      });

    // --- 新增：快捷键注册管理逻辑 ---
    const manageHotkey = async () => {
      if (isRegisteringRef.current) {
        console.log("[Effect] 快捷键注册已在进行中，跳过本次。");
        return;
      }
      isRegisteringRef.current = true;
      console.log("[Effect] 正在管理快捷键注册...");

      try {
        // 防御性注销：检查是否已注册（可能来自非正常关闭）
        if (await isRegistered(QUERY_HOTKEY)) {
          console.log(
            `[Effect] 快捷键 ${QUERY_HOTKEY} 可能已存在，先尝试注销。`
          );
          await unregister(QUERY_HOTKEY);
          console.log(`[Effect] 防御性注销 ${QUERY_HOTKEY} 成功。`);
        }

        // 注册快捷键
        console.log(`[Effect] 正在注册快捷键: ${QUERY_HOTKEY}`);
        await register(QUERY_HOTKEY, () => {
          // 快捷键回调应尽可能轻量，将复杂逻辑委托给其他函数
          console.log(`[Effect] 检测到快捷键 ${QUERY_HOTKEY} 按下。`);
          openOrFocusQueryWindow(); // 调用实际的处理函数
        });
        isHotkeyRegisteredInThisEffect = true; // 标记本 effect 成功注册
        console.log(`[Effect] 快捷键 ${QUERY_HOTKEY} 注册成功。`);
        // 可选：给用户一个提示
        // message.info(`查询快捷键 (${QUERY_HOTKEY}) 已激活`, 2);
      } catch (err) {
        console.error(`[Effect] 注册快捷键 ${QUERY_HOTKEY} 失败:`, err);
        message.error(`快捷键 ${QUERY_HOTKEY} 可能已被其他程序占用。`);
        isHotkeyRegisteredInThisEffect = false; // 标记注册失败
      } finally {
        isRegisteringRef.current = false; // 释放注册锁
        console.log("[Effect] 快捷键管理流程结束。");
      }
    };

    // 触发快捷键注册管理
    manageHotkey();

    // --- 清理函数 ---
    return () => {
      console.log("[App.tsx] 组件即将卸载，执行清理...");

      // --- 清理托盘 ---
      // Option 1: 调用 setupTray 返回的特定清理函数
      if (trayCleanupFunc) {
        console.log(
          "[App.tsx] 正在调用 setupTray 返回的特定清理函数 (unlisten)..."
        );
        try {
          trayCleanupFunc();
        } catch (error) {
          console.error("[App.tsx] 调用特定托盘清理函数时出错:", error);
        }
      } else {
        console.log("[App.tsx] 没有收到或无法调用特定的托盘清理函数。");
      }

      // Option 2: 调用通用的托盘清理函数
      console.log("[App.tsx] 正在调用通用 cleanupTray...");
      try {
        cleanupTray();
        console.log("[App.tsx] cleanupTray 调用成功。");
      } catch (error) {
        console.error("[App.tsx] 调用通用 cleanupTray 时出错:", error);
      }

      // --- 新增：清理快捷键 ---
      console.log("[App.tsx] 正在清理快捷键...");
      if (isHotkeyRegisteredInThisEffect) {
        console.log(
          `[App.tsx Cleanup] 尝试注销由本 effect 注册的快捷键 ${QUERY_HOTKEY}...`
        );
        unregister(QUERY_HOTKEY)
          .then(() =>
            console.log(`[App.tsx Cleanup] 快捷键 ${QUERY_HOTKEY} 注销成功。`)
          )
          .catch((err) =>
            console.error(
              `[App.tsx Cleanup] 注销快捷键 ${QUERY_HOTKEY} 失败:`,
              err
            )
          );
      } else {
        console.log(
          `[App.tsx Cleanup] 跳过快捷键注销，因为它未被本 effect 成功注册。`
        );
      }

      // --- 重置 Refs ---
      isRegisteringRef.current = false;
      isProcessingHotkeyRef.current = false;

      console.log("[App.tsx] 清理流程结束。");
    };
  }, []); // 空依赖数组确保只在挂载和卸载时运行

  return (
    <div className="AppContainer">
      <Routes>
        <Route path="/" element={<GitHubAuth />} />
        <Route path="/screenshot" element={<ScreenshotPage />} />
      </Routes>
    </div>
  );
}

export default App;

src/screenshot/query.tsx:
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

src/screenshot/query.css:
/* src/screenshot/query.css */
.query-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 25px;
  height: 100vh; /* 让容器填满窗口高度 */
  box-sizing: border-box; /* padding 不会撑大元素 */
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
  background-color: #f8f9fa; /* 淡灰色背景 */
  gap: 15px; /* 元素之间的间距 */
}

.query-title {
  color: #333;
  margin-bottom: 15px;
  font-size: 1.5em;
}

.query-input {
  padding: 10px 15px;
  border: 1px solid #ced4da;
  border-radius: 4px;
  font-size: 1em;
  width: 80%; /* 占据容器宽度的80% */
  max-width: 400px; /* 最大宽度 */
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.075);
}

.query-input:focus {
  outline: none;
  border-color: #80bdff;
  box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
}

.query-button {
  padding: 10px 20px;
  font-size: 1em;
  color: #fff;
  background-color: #007bff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s ease-in-out;
}

.query-button:hover {
  background-color: #0056b3;
}

.query-button:active {
  background-color: #004085;
}

.query-feedback {
  margin-top: 10px;
  font-size: 0.9em;
  color: #6c757d;
}


```
