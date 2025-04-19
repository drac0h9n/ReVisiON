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
