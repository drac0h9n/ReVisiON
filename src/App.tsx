// src/App.tsx
// Import routing components
import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
// Import page components
import GitHubAuth from "@/login/GitHubAuth";
import ScreenshotPage from "@/screenshot/ScreenshotPage"; // We will create this next
import "./App.css"; // Import your CSS file
import { setupTray, cleanupTray } from "@/core/tray";
function App() {
  useEffect(() => {
    console.log("[App.tsx] Component did mount. Calling setupTray..."); // Log before call
    let cleanupFunc: (() => void) | null = null;

    setupTray()
      .then((unlisten) => {
        console.log("[App.tsx] setupTray Promise resolved."); // Log when promise finishes
        if (unlisten) {
          cleanupFunc = unlisten; // Store the specific unlisten from setupTray if needed
          console.log("[App.tsx] Received unlisten function.");
        } else {
          console.warn(
            "[App.tsx] setupTray resolved but returned null (likely setup failure)."
          );
        }
      })
      .catch((error) => {
        console.error("[App.tsx] Error calling setupTray:", error); // Catch errors during setup
      });

    // Cleanup function
    return () => {
      console.log("[App.tsx] Component will unmount. Calling cleanupTray..."); // Log before cleanup
      // Choose one cleanup method depending on what setupTray returns/needs:
      // Option 1: If setupTray only returns the menu listener cleanup
      // if (cleanupFunc) {
      //   cleanupFunc();
      // }
      // Option 2: Call your generic cleanup function
      cleanupTray();
      console.log("[App.tsx] cleanupTray called.");
    };
  }, []); // Empty dependency array means this runs once on mount
  // App component now acts as the main router outlet
  return (
    <div className="AppContainer">
      {" "}
      {/* Optional outer container */}
      <Routes>
        {/* Route for the login/profile page */}
        <Route path="/" element={<GitHubAuth />} />
        {/* Route for the new screenshot page */}
        <Route path="/screenshot" element={<ScreenshotPage />} />
        {/* You can add more routes here later */}
      </Routes>
    </div>
  );
}

export default App;
