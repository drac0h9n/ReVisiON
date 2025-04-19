// src/App.tsx
import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import GitHubAuth from "@/login/GitHubAuth";
import ScreenshotPage from "@/screenshot/ScreenshotPage";
import "./App.css";
import { setupTray, cleanupTray } from "@/core/tray";

function App() {
  useEffect(() => {
    console.log("[App.tsx] Component did mount. Calling setupTray...");
    let cleanupFunc: (() => void) | null = null;

    setupTray()
      .then((unlisten) => {
        console.log("[App.tsx] setupTray Promise resolved.");
        if (unlisten && typeof unlisten === "function") {
          // 增加一个类型检查确保是函数
          cleanupFunc = unlisten;
          console.log("[App.tsx] Received unlisten function.");
        } else {
          console.warn(
            "[App.tsx] setupTray resolved but did not return a valid unlisten function."
          );
        }
      })
      .catch((error) => {
        console.error("[App.tsx] Error calling setupTray:", error);
      });

    // Cleanup function
    return () => {
      console.log("[App.tsx] Component will unmount. Calling cleanup...");

      // Option 1: Call the specific cleanup function from setupTray if available
      if (cleanupFunc) {
        // <--- 取消注释
        console.log(
          "[App.tsx] Calling specific cleanupFunc (unlisten) returned by setupTray."
        );
        try {
          // 添加 try...catch 以增加健壮性
          cleanupFunc(); // <--- 取消注释
        } catch (error) {
          console.error("[App.tsx] Error calling specific cleanupFunc:", error);
        }
      } else {
        console.log(
          "[App.tsx] No specific cleanupFunc received or available to call."
        );
      }

      // Option 2: Call your generic cleanup function (保留，可能处理其他或作为备用)
      console.log("[App.tsx] Calling generic cleanupTray...");
      try {
        // 添加 try...catch 以增加健壮性
        cleanupTray();
        console.log("[App.tsx] cleanupTray called successfully.");
      } catch (error) {
        console.error("[App.tsx] Error calling generic cleanupTray:", error);
      }
      console.log("[App.tsx] Cleanup process finished.");
    };
  }, []); // Empty dependency array means this runs once on mount

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
