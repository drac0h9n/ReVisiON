// src/App.tsx
import { useEffect, useRef } from "react";
import { Routes, Route } from "react-router-dom";
import { message } from "antd";

// 应用内组件
import GitHubAuth from "@/login/GitHubAuth";
import ScreenshotPage from "@/screenshot/ScreenshotPage";
import { setupTray, cleanupTray } from "@/core/tray";

// Tauri API 和插件 (Corrected Imports)
import {
  register,
  unregister,
  isRegistered,
} from "@tauri-apps/plugin-global-shortcut";
import {
  WebviewWindow, // Keep using WebviewWindow for creating/managing windows
  getAllWebviewWindows,
} from "@tauri-apps/api/webviewWindow"; // Correct path for WebviewWindow
import { emitTo } from "@tauri-apps/api/event"; // Correct path for emitTo
import {
  getScreenshotableMonitors,
  getMonitorScreenshot,
} from "tauri-plugin-screenshots-api";
import { checkScreenRecordingPermission } from "tauri-plugin-macos-permissions-api";
import { type as osType } from "@tauri-apps/plugin-os";

// 样式
import "./App.css";

// --- 常量 ---
const QUERY_HOTKEY = "CmdOrCtrl+Shift+Q";
const QUERY_WINDOW_LABEL = "screenshot_query_window";
const QUERY_WINDOW_URL = "screenshot_query.html";

function App() {
  const isRegisteringRef = useRef(false);
  const isProcessingHotkeyRef = useRef(false);

  const handleHotkeyTrigger = async () => {
    if (isProcessingHotkeyRef.current) {
      console.warn(`[Hotkey] 操作已在进行中，忽略本次触发。`);
      return;
    }
    isProcessingHotkeyRef.current = true;
    console.log(`[Hotkey] 快捷键 ${QUERY_HOTKEY} 已触发，开始执行处理流程...`);

    let filePath: string | null = null;

    try {
      // 1. 权限检查 (仅 macOS)
      if (osType() === "macos") {
        console.log("[Hotkey] 检测到 macOS，执行屏幕录制权限检查...");
        let hasPermission = false;
        try {
          hasPermission = await checkScreenRecordingPermission();
          console.log(`[Hotkey] 屏幕录制权限状态: ${hasPermission}`);
          if (!hasPermission) {
            message.error(
              "需要屏幕录制权限才能截图。请在系统设置 > 隐私与安全 > 屏幕录制中授权本应用。",
              5
            );
            console.error("[Hotkey] 屏幕录制权限不足。");
            throw new Error("屏幕录制权限不足");
          }
        } catch (permError) {
          console.error("[Hotkey] 检查屏幕录制权限时出错:", permError);
          message.error(
            `检查权限失败: ${
              permError instanceof Error ? permError.message : String(permError)
            }`,
            3
          );
          throw permError;
        }
      } else {
        console.log("[Hotkey] 非 macOS 系统，跳过权限检查。");
      }

      // 2. 执行截图 (Requires getting monitor ID first)
      console.log("[Hotkey] 正在获取可用监视器列表...");
      let primaryMonitorId: number | undefined;
      try {
        const monitors = await getScreenshotableMonitors();
        if (!monitors || monitors.length === 0) {
          throw new Error("未能获取到可截图的监视器。");
        }
        primaryMonitorId = monitors[0].id; // Assumption: first is primary
        console.log(
          `[Hotkey] 识别到主监视器 (假设为第一个): ID=${primaryMonitorId}, Name=${monitors[0].name}`
        );
      } catch (monitorError) {
        console.error("[Hotkey] 获取监视器列表失败:", monitorError);
        message.error(
          `获取监视器失败: ${
            monitorError instanceof Error
              ? monitorError.message
              : String(monitorError)
          }`,
          3
        );
        throw monitorError;
      }

      if (primaryMonitorId === undefined) {
        throw new Error("未能确定主监视器 ID。");
      }

      console.log(`[Hotkey] 尝试获取监视器 ID ${primaryMonitorId} 的截图...`);
      try {
        filePath = await getMonitorScreenshot(primaryMonitorId);
        console.log(`[Hotkey] 截图成功，文件路径: ${filePath}`);
        if (!filePath) {
          throw new Error("截图 API 返回了空路径。");
        }
      } catch (screenshotError) {
        console.error("[Hotkey] 截图失败:", screenshotError);
        message.error(
          `截图失败: ${
            screenshotError instanceof Error
              ? screenshotError.message
              : String(screenshotError)
          }`,
          3
        );
        throw screenshotError;
      }

      // --- 3. 窗口处理 ---
      const allWindows = await getAllWebviewWindows();
      const existingWindow = allWindows.find(
        (win) => win.label === QUERY_WINDOW_LABEL
      );

      if (existingWindow) {
        // --- Handle Existing Window ---
        console.log(
          `[Hotkey] 窗口 "${QUERY_WINDOW_LABEL}" 已存在，尝试聚焦并发送截图。`
        );
        if (await existingWindow.isMinimized()) {
          await existingWindow.unminimize();
        }
        if (!(await existingWindow.isVisible())) {
          await existingWindow.show();
        }
        await existingWindow.setFocus();

        // Emit screenshot path to the existing window
        console.log(
          `[Hotkey] Emitting 'new_screenshot' event to window "${QUERY_WINDOW_LABEL}"`
        );
        await emitTo(QUERY_WINDOW_LABEL, "new_screenshot", {
          path: filePath, // filePath is non-null here
        });
        message.info("查询窗口已聚焦并更新截图", 1.5);
      } else {
        // --- Handle New Window Creation ---
        console.log(
          `[Hotkey] 窗口 "${QUERY_WINDOW_LABEL}" 未找到，正在创建新窗口...`
        );

        // Create the window WITHOUT initializationScript
        const webviewWindow = new WebviewWindow(QUERY_WINDOW_LABEL, {
          url: QUERY_WINDOW_URL,
          title: "Query with Screenshot",
          width: 450,
          height: 550,
          resizable: true,
          decorations: true,
          alwaysOnTop: false,
          center: true,
          focus: true,
          // removed: initializationScript: initScript, <--- REMOVED
        });

        // --- Use emitTo AFTER creation is confirmed ---
        webviewWindow.once("tauri://created", async () => {
          // Make listener async
          console.log(`[Hotkey] 窗口 "${QUERY_WINDOW_LABEL}" 创建成功。`);
          message.success("查询窗口已打开，正在发送截图...", 1.5); // Update message

          // Emit the 'new_screenshot' event to the window *just created*
          try {
            console.log(
              `[Hotkey] Emitting 'new_screenshot' to newly created window "${QUERY_WINDOW_LABEL}"`
            );
            // filePath is guaranteed non-null here because if screenshot failed,
            // an error would have been thrown earlier.
            await emitTo(QUERY_WINDOW_LABEL, "new_screenshot", {
              path: filePath,
            });
          } catch (emitError) {
            console.error(
              `[Hotkey] Failed to emit initial screenshot to new window:`,
              emitError
            );
            message.error("未能将截图发送到新窗口");
          }
        });

        // Standard error handling for creation
        webviewWindow.once("tauri://error", (e) => {
          console.error(`[Hotkey] 创建窗口 "${QUERY_WINDOW_LABEL}" 失败:`, e);
          message.error(`打开查询窗口失败: ${e}`);
          // No need to emit if creation failed
        });
      }
    } catch (error) {
      console.error("[Hotkey] 处理快捷键触发时发生错误:", error);
      // Errors leading to this point (permissions, monitor, screenshot)
      // likely already showed a message.
    } finally {
      isProcessingHotkeyRef.current = false; // Release the lock
      console.log(`[Hotkey] 处理流程执行完毕。`);
    }
  };

  // --- useEffect hook remains the same ---
  useEffect(() => {
    console.log("[App.tsx] 组件挂载，开始执行 useEffect...");
    let trayCleanupFunc: (() => void) | null = null;
    let isHotkeyRegisteredInThisEffect = false;

    // Setup Tray
    console.log("[App.tsx] 正在调用 setupTray...");
    setupTray()
      .then((unlisten) => {
        if (unlisten && typeof unlisten === "function") {
          trayCleanupFunc = unlisten;
        } else {
          console.warn("[App.tsx] setupTray 未返回有效的 unlisten 函数。");
        }
      })
      .catch((error) => {
        console.error("[App.tsx] 调用 setupTray 时出错:", error);
      });

    // Manage Hotkey
    const manageHotkey = async () => {
      if (isRegisteringRef.current) return;
      isRegisteringRef.current = true;
      console.log("[Effect] 正在管理快捷键注册...");

      try {
        if (await isRegistered(QUERY_HOTKEY)) {
          console.log(`[Effect] 防御性注销 ${QUERY_HOTKEY}。`);
          await unregister(QUERY_HOTKEY);
        }

        console.log(`[Effect] 正在注册快捷键: ${QUERY_HOTKEY}`);
        await register(QUERY_HOTKEY, handleHotkeyTrigger);
        isHotkeyRegisteredInThisEffect = true;
        console.log(`[Effect] 快捷键 ${QUERY_HOTKEY} 注册成功。`);
      } catch (err) {
        console.error(`[Effect] 注册快捷键 ${QUERY_HOTKEY} 失败:`, err);
        message.error(`快捷键 ${QUERY_HOTKEY} 可能已被占用。`);
        isHotkeyRegisteredInThisEffect = false;
      } finally {
        isRegisteringRef.current = false;
        console.log("[Effect] 快捷键管理流程结束。");
      }
    };

    manageHotkey();

    // --- 清理函数 ---
    return () => {
      console.log("[App.tsx] 组件即将卸载，执行清理...");

      // 清理托盘
      // FIX for Error 2: Wrap synchronous cleanupTray call in try...catch
      // Remove .catch() as cleanupTray returns void, not a Promise
      if (trayCleanupFunc) {
        try {
          trayCleanupFunc(); // Call the specific unlisten function from setupTray
          console.log("[App.tsx Cleanup] 特定托盘清理函数调用成功。");
        } catch (error) {
          console.error("[App.tsx Cleanup] 调用特定托盘清理函数时出错:", error);
        }
      }
      try {
        cleanupTray(); // Call the general cleanup function
        console.log("[App.tsx Cleanup] 通用 cleanupTray 调用成功。");
      } catch (error) {
        // Catch synchronous errors from cleanupTray if any
        console.error("[App.tsx Cleanup] 调用通用 cleanupTray 时出错:", error);
      }

      // 清理快捷键
      console.log("[App.tsx Cleanup] 正在清理快捷键...");
      if (isHotkeyRegisteredInThisEffect) {
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

      isRegisteringRef.current = false;
      isProcessingHotkeyRef.current = false;
      console.log("[App.tsx Cleanup] 清理流程结束。");
    };
  }, []);

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
