// src/screenshot/ScreenshotPage.tsx
import { useState, useEffect, useCallback, useRef } from "react"; // Import useRef
import { useNavigate } from "react-router-dom";
import { Button, Spin, Image, message, Divider } from "antd";
import { useBoolean } from "ahooks";

// Tauri API and Plugins
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  getScreenshotableMonitors,
  getMonitorScreenshot,
  ScreenshotableMonitor,
} from "tauri-plugin-screenshots-api";
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
  checkScreenRecordingPermission,
  requestScreenRecordingPermission,
} from "tauri-plugin-macos-permissions-api";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";

const SCREENSHOT_HOTKEY = "CmdOrCtrl+Shift+S";

function ScreenshotPage() {
  const navigate = useNavigate();

  // --- Ref to track if the initial hotkey active message was shown ---
  const didLogHotkeyActive = useRef(false);

  // --- State --- (Keep existing state variables)
  const [hasAccessibility, setHasAccessibility] = useState<boolean | null>(
    null
  );
  const [hasScreenRecording, setHasScreenRecording] = useState<boolean | null>(
    null
  );
  const [
    isCheckingPermissions,
    { setTrue: startChecking, setFalse: stopChecking },
  ] = useBoolean(false);
  const [isRequestingAccessibility, setIsRequestingAccessibility] =
    useState(false);
  const [isRequestingScreenRecording, setIsRequestingScreenRecording] =
    useState(false);
  const [
    isTakingScreenshot,
    { setTrue: startScreenshot, setFalse: stopScreenshot },
  ] = useBoolean(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [monitors, setMonitors] = useState<ScreenshotableMonitor[]>([]);
  const [error, setError] = useState<string | null>(null);

  // --- Functions --- (Keep existing fetchMonitors, checkPermissions, request handlers)
  const fetchMonitors = useCallback(async () => {
    console.log("Fetching monitors...");
    try {
      const fetchedMonitors = await getScreenshotableMonitors();
      setMonitors(fetchedMonitors);
      console.log("Monitors fetched:", fetchedMonitors);
    } catch (err) {
      console.error("Error fetching monitors:", err);
      setError(
        (prev) => (prev ? prev + "\n" : "") + `Monitor fetch failed: ${err}`
      );
      setMonitors([]);
    }
  }, []);

  const checkPermissions = useCallback(
    async (showLoading = false) => {
      setError(null);
      if (showLoading) startChecking();
      let screenGranted = false;
      try {
        setHasAccessibility(await checkAccessibilityPermission());
        screenGranted = await checkScreenRecordingPermission();
        setHasScreenRecording(screenGranted);
        if (screenGranted) {
          await fetchMonitors();
        } else {
          setMonitors([]);
        }
      } catch (err) {
        console.error("Permission check failed:", err);
        setError(
          (prev) =>
            (prev ? prev + "\n" : "") + `Permission check failed: ${err}`
        );
        // Assume false on error
        setHasAccessibility(false);
        setHasScreenRecording(false);
        setMonitors([]);
      } finally {
        if (showLoading) stopChecking();
      }
    },
    [startChecking, stopChecking, fetchMonitors]
  );

  useEffect(() => {
    checkPermissions(true);
  }, [checkPermissions]);

  const handleRequestAccessibility = useCallback(async () => {
    // ... existing logic ...
    if (hasAccessibility) return;
    setIsRequestingAccessibility(true);
    try {
      await requestAccessibilityPermission();
      const granted = await checkAccessibilityPermission();
      setHasAccessibility(granted);
      message[granted ? "success" : "warning"](
        granted ? "Accessibility granted!" : "Accessibility needed."
      );
    } catch (err) {
      message.error(`Accessibility request failed: ${err}`);
    } finally {
      setIsRequestingAccessibility(false);
    }
  }, [hasAccessibility]);

  const handleRequestScreenRecording = useCallback(async () => {
    // ... existing logic ...
    if (hasScreenRecording) return;
    setIsRequestingScreenRecording(true);
    try {
      await requestScreenRecordingPermission();
      const granted = await checkScreenRecordingPermission();
      setHasScreenRecording(granted);
      if (granted) {
        message.success("Screen Recording granted!");
        await fetchMonitors();
      } else {
        message.warning("Screen Recording needed.");
        setMonitors([]);
      }
    } catch (err) {
      message.error(`Screen Recording request failed: ${err}`);
    } finally {
      setIsRequestingScreenRecording(false);
    }
  }, [hasScreenRecording, fetchMonitors]);

  // --- Handler to Take Screenshot (Keep the robust version from previous step) ---
  const handleTakeScreenshot = useCallback(
    async (source: "button" | "hotkey" = "button") => {
      if (isTakingScreenshot) {
        console.log(
          `Screenshot action (${source}) ignored: already in progress.`
        );
        return;
      }
      let currentScreenPermission: boolean;
      try {
        currentScreenPermission = await checkScreenRecordingPermission();
      } catch (permError) {
        message.error("Perm check failed.");
        return;
      }

      if (!currentScreenPermission) {
        setHasScreenRecording(false);
        message.error("Screen recording permission required.");
        return;
      }
      if (!hasScreenRecording) setHasScreenRecording(true); // Update state if needed

      let currentMonitors = monitors;
      if (currentMonitors.length === 0) {
        console.log("No monitors in state, fetching...");
        try {
          currentMonitors = await getScreenshotableMonitors(); // Fetch directly
          if (currentMonitors.length === 0) {
            message.error("No monitors detected.");
            return;
          }
          setMonitors(currentMonitors); // Update state
        } catch {
          message.error("Failed to fetch monitors.");
          return;
        }
      }

      const primaryMonitor = currentMonitors[0];
      if (!primaryMonitor) {
        message.error("Primary monitor not found.");
        return;
      }

      console.log(
        `Attempting screenshot (${source}) on monitor: ${primaryMonitor.name}`
      );
      startScreenshot();
      setScreenshotUrl(null);
      // setError(null); // Decide if you want to clear general errors here

      try {
        const filePath = await getMonitorScreenshot(primaryMonitor.id);
        const assetUrl = convertFileSrc(filePath);
        const finalUrl = `${assetUrl}?t=${Date.now()}`; // Cache bust
        setScreenshotUrl(finalUrl);
        message.success(`Screenshot captured! (${source})`);
      } catch (err) {
        const errorMsg = `Screenshot Failed (${source}): ${
          err instanceof Error ? err.message : String(err)
        }`;
        setError((prev) => (prev ? prev + "\n" : "") + errorMsg);
        message.error("Screenshot failed.");
        setScreenshotUrl(null);
      } finally {
        stopScreenshot();
      }
    },
    [
      isTakingScreenshot,
      monitors,
      hasScreenRecording,
      fetchMonitors, // Keep fetchMonitors here as it might be called
      startScreenshot,
      stopScreenshot,
    ]
  );

  // --- Register and Unregister Global Hotkey ---
  useEffect(() => {
    let isHotkeyCurrentlyRegistered = false;

    const registerAndLog = async () => {
      try {
        const hotkeyCallback = () => handleTakeScreenshot("hotkey");
        console.log(`Attempting to register hotkey: ${SCREENSHOT_HOTKEY}`);
        await register(SCREENSHOT_HOTKEY, hotkeyCallback);
        isHotkeyCurrentlyRegistered = true;
        console.log(`Hotkey ${SCREENSHOT_HOTKEY} registered successfully.`);

        // --- FIX: Check the ref before logging ---
        if (!didLogHotkeyActive.current) {
          message.info(`Screenshot hotkey (${SCREENSHOT_HOTKEY}) active.`, 2);
          didLogHotkeyActive.current = true; // Mark as logged for this mount
        }
        // -----------------------------------------
      } catch (err) {
        console.error(`Failed to register hotkey ${SCREENSHOT_HOTKEY}:`, err);
        message.error(`Hotkey ${SCREENSHOT_HOTKEY} may be in use.`);
        isHotkeyCurrentlyRegistered = false;
      }
    };

    registerAndLog();

    // Cleanup function
    return () => {
      if (isHotkeyCurrentlyRegistered) {
        console.log(`Unregistering hotkey: ${SCREENSHOT_HOTKEY}`);
        unregister(SCREENSHOT_HOTKEY)
          .then(() => console.log(`Hotkey ${SCREENSHOT_HOTKEY} unregistered.`))
          .catch((err) => console.error(`Failed to unregister hotkey:`, err));
        // We don't reset the ref here, only on true unmount
      }
    };
  }, [handleTakeScreenshot]); // Dependency remains correct

  // --- Effect to Reset Log Ref on Unmount ---
  useEffect(() => {
    // This effect runs once on mount and its cleanup runs once on unmount
    return () => {
      console.log("ScreenshotPage unmounting, resetting hotkey log flag.");
      didLogHotkeyActive.current = false;
    };
  }, []); // Empty dependency array ensures it runs only on mount/unmount

  // --- Helper ---
  const getStatusText = (status: boolean | null): string => {
    if (status === null) return "Checking...";
    return status ? "Granted ✅" : "Not Granted ❌";
  };

  // --- Render --- (Keep existing JSX structure)
  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      <Spin
        spinning={isCheckingPermissions}
        fullscreen={isCheckingPermissions}
      />
      <h1>Screen Permissions & Screenshot (macOS)</h1>
      <p>
        Press <strong>{SCREENSHOT_HOTKEY}</strong> or click the button below.
      </p>
      {error && (
        <pre
          style={{
            color: "red",
            border: "1px solid red",
            padding: "10px",
            whiteSpace: "pre-wrap",
            marginBottom: "15px",
          }}
        >
          {" "}
          Errors Encountered:\n{error}{" "}
        </pre>
      )}

      {/* Permission Sections */}
      <div
        style={{
          marginBottom: "20px",
          padding: "15px",
          border: "1px solid #eee",
          borderRadius: "5px",
        }}
      >
        <h2>Accessibility Permission</h2>
        <p>
          Status: <strong>{getStatusText(hasAccessibility)}</strong>
        </p>
        <Button
          onClick={handleRequestAccessibility}
          disabled={hasAccessibility === true || isRequestingAccessibility}
          loading={isRequestingAccessibility}
        >
          {" "}
          {hasAccessibility ? "Granted" : "Request"}{" "}
        </Button>
      </div>
      <div
        style={{
          marginBottom: "20px",
          padding: "15px",
          border: "1px solid #eee",
          borderRadius: "5px",
        }}
      >
        <h2>Screen Recording Permission</h2>
        <p>
          Status: <strong>{getStatusText(hasScreenRecording)}</strong>
        </p>
        <Button
          onClick={handleRequestScreenRecording}
          disabled={hasScreenRecording === true || isRequestingScreenRecording}
          loading={isRequestingScreenRecording}
        >
          {" "}
          {hasScreenRecording ? "Granted" : "Request"}{" "}
        </Button>
      </div>

      <Divider />

      {/* Screenshot Section */}
      <h2>Take Screenshot</h2>
      <div
        style={{
          marginBottom: "20px",
          padding: "15px",
          border: "1px solid #eee",
          borderRadius: "5px",
        }}
      >
        <Button
          type="primary"
          onClick={() => handleTakeScreenshot("button")}
          disabled={
            !hasScreenRecording ||
            isTakingScreenshot ||
            (hasScreenRecording &&
              monitors.length === 0 &&
              !isCheckingPermissions)
          }
          loading={isTakingScreenshot}
          style={{ marginRight: "10px" }}
        >
          {isTakingScreenshot
            ? "Capturing..."
            : `Capture ${monitors.length > 0 ? monitors[0]?.name : "Monitor"}`}
        </Button>
        {/* Status indicators */}
        {!hasScreenRecording && (
          <span style={{ color: "orange" }}>
            Requires Screen Recording permission.
          </span>
        )}
        {hasScreenRecording &&
          monitors.length === 0 &&
          !isCheckingPermissions &&
          !isTakingScreenshot && (
            <span style={{ color: "orange" }}>Could not detect monitors.</span>
          )}

        {/* Preview */}
        {screenshotUrl && (
          <div style={{ marginTop: "15px" }}>
            <h3>Screenshot Preview:</h3>
            <Image
              key={screenshotUrl}
              width={200}
              src={screenshotUrl}
              alt="Screenshot Preview"
              placeholder={<Spin size="large" />}
              style={{ border: "1px solid #ccc" }}
            />
          </div>
        )}
        {isTakingScreenshot && !screenshotUrl && (
          <div style={{ marginTop: "15px" }}>
            <Spin /> Capturing...
          </div>
        )}
      </div>

      <Divider />

      {/* Actions */}
      <Button
        onClick={() => checkPermissions(true)}
        disabled={isCheckingPermissions}
        loading={isCheckingPermissions}
        style={{ marginRight: "10px" }}
      >
        {" "}
        Refresh Permissions{" "}
      </Button>
      <Button onClick={() => navigate(-1)}>Back</Button>
    </div>
  );
}

export default ScreenshotPage;
