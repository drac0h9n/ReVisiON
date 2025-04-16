// src/screenshot/ScreenshotPage.tsx
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Spin, Image, message, Divider } from "antd"; // Import Ant Design components
import { useBoolean } from "ahooks"; // Using ahooks for loading state for consistency

// Tauri API and Plugins
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  getScreenshotableMonitors, // To find a monitor to screenshot
  getMonitorScreenshot, // To take the screenshot
  ScreenshotableMonitor, // Type for monitor info
} from "tauri-plugin-screenshots-api";
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
  checkScreenRecordingPermission,
  requestScreenRecordingPermission,
} from "tauri-plugin-macos-permissions-api"; // Make sure path is correct

function ScreenshotPage() {
  const navigate = useNavigate();

  // --- State for Permissions ---
  const [hasAccessibility, setHasAccessibility] = useState<boolean | null>(
    null
  );
  const [hasScreenRecording, setHasScreenRecording] = useState<boolean | null>(
    null
  );

  // --- State for Loading Indicators ---
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

  // --- State for Screenshot ---
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [monitors, setMonitors] = useState<ScreenshotableMonitor[]>([]);

  // --- State for Errors ---
  const [error, setError] = useState<string | null>(null);

  // --- Function to check both permissions ---
  const checkPermissions = useCallback(
    async (showLoading = false) => {
      setError(null);
      if (showLoading) startChecking();
      console.log("Checking permissions...");

      let accessGranted = false;
      let screenGranted = false;

      try {
        accessGranted = await checkAccessibilityPermission();
        console.log("Accessibility Permission Status:", accessGranted);
        setHasAccessibility(accessGranted);
      } catch (err) {
        console.error(
          "Error checking or processing accessibility permission:",
          err
        );
        setError(
          (prev) =>
            (prev ? prev + "\n" : "") +
            `Failed to check accessibility: ${
              err instanceof Error ? err.message : String(err)
            }`
        );
        setHasAccessibility(false);
      }

      try {
        screenGranted = await checkScreenRecordingPermission();
        console.log("Screen Recording Permission Status:", screenGranted);
        setHasScreenRecording(screenGranted);
      } catch (err) {
        console.error(
          "Error checking or processing screen recording permission:",
          err
        );
        setError(
          (prev) =>
            (prev ? prev + "\n" : "") +
            `Failed to check screen recording: ${
              err instanceof Error ? err.message : String(err)
            }`
        );
        setHasScreenRecording(false);
      }

      if (showLoading) stopChecking();

      // If screen recording permission is granted, fetch monitors
      if (screenGranted) {
        fetchMonitors();
      } else {
        setMonitors([]); // Clear monitors if permission is lost
      }
    },
    [startChecking, stopChecking]
  ); // Added dependencies

  // --- Function to fetch monitors (needed for screenshot) ---
  const fetchMonitors = useCallback(async () => {
    console.log("Fetching monitors...");
    try {
      const fetchedMonitors = await getScreenshotableMonitors();
      setMonitors(fetchedMonitors);
      console.log("Monitors fetched:", fetchedMonitors);
    } catch (err) {
      console.error("Error fetching monitors:", err);
      setError(
        (prev) =>
          (prev ? prev + "\n" : "") +
          `Failed to fetch monitors: ${
            err instanceof Error ? err.message : String(err)
          }`
      );
      setMonitors([]); // Clear on error
    }
  }, []); // No dependencies needed

  // --- Initial check and monitor fetch on mount ---
  useEffect(() => {
    checkPermissions(true); // Also fetches monitors if permission is already granted
  }, [checkPermissions]);

  // --- Handlers for Requesting Permissions ---
  const handleRequestAccessibility = useCallback(async () => {
    if (hasAccessibility) return;
    setIsRequestingAccessibility(true);
    setError(null);
    try {
      console.log("Requesting Accessibility permission...");
      await requestAccessibilityPermission();
      console.log("Re-checking Accessibility permission after request...");
      const accessGranted = await checkAccessibilityPermission();
      setHasAccessibility(accessGranted);
      console.log("Accessibility status after request:", accessGranted);
      if (!accessGranted) {
        message.warning(
          "Accessibility permission needed. Grant manually in System Settings if prompted."
        );
      } else {
        message.success("Accessibility permission granted!");
      }
    } catch (err) {
      console.error("Error requesting/re-checking accessibility:", err);
      const errorMsg = `Failed requesting accessibility: ${
        err instanceof Error ? err.message : String(err)
      }`;
      setError((prev) => (prev ? prev + "\n" : "") + errorMsg);
      message.error(errorMsg);
    } finally {
      setIsRequestingAccessibility(false);
    }
  }, [hasAccessibility]);

  const handleRequestScreenRecording = useCallback(async () => {
    if (hasScreenRecording) return;
    setIsRequestingScreenRecording(true);
    setError(null);
    try {
      console.log("Requesting Screen Recording permission...");
      await requestScreenRecordingPermission();
      console.log("Re-checking Screen Recording permission after request...");
      const screenGranted = await checkScreenRecordingPermission();
      setHasScreenRecording(screenGranted);
      console.log("Screen Recording status after request:", screenGranted);
      if (screenGranted) {
        message.success("Screen Recording permission granted!");
        fetchMonitors(); // Fetch monitors immediately after granting permission
      } else {
        message.warning(
          "Screen Recording permission needed. Grant manually in System Settings if prompted."
        );
        setMonitors([]); // Clear monitors if permission still not granted
      }
    } catch (err) {
      console.error("Error requesting/re-checking screen recording:", err);
      const errorMsg = `Failed requesting screen recording: ${
        err instanceof Error ? err.message : String(err)
      }`;
      setError((prev) => (prev ? prev + "\n" : "") + errorMsg);
      message.error(errorMsg);
    } finally {
      setIsRequestingScreenRecording(false);
    }
  }, [hasScreenRecording, fetchMonitors]); // Added fetchMonitors dependency

  // --- Handler to Take Screenshot ---
  const handleTakeScreenshot = useCallback(async () => {
    if (!hasScreenRecording) {
      message.error(
        "Screen recording permission is required to take screenshots."
      );
      return;
    }
    if (monitors.length === 0) {
      message.error("No monitors found or accessible.");
      // Maybe try fetching again?
      await fetchMonitors();
      if (monitors.length === 0) return; // Still no monitors, stop
    }

    // Let's take a screenshot of the first monitor found
    const primaryMonitor = monitors[0];
    if (!primaryMonitor) {
      message.error("Could not identify a primary monitor.");
      return;
    }

    console.log(
      `Attempting to screenshot monitor: ${primaryMonitor.name} (ID: ${primaryMonitor.id})`
    );
    startScreenshot();
    setScreenshotUrl(null); // Clear previous screenshot
    setError(null);

    try {
      const filePath = await getMonitorScreenshot(primaryMonitor.id);
      console.log("Screenshot saved to:", filePath);
      const assetUrl = convertFileSrc(filePath);
      setScreenshotUrl(assetUrl);
      message.success(`Screenshot of ${primaryMonitor.name} captured!`);
    } catch (err) {
      console.error("Error taking screenshot:", err);
      const errorMsg = `Failed to take screenshot: ${
        err instanceof Error ? err.message : String(err)
      }`;
      setError((prev) => (prev ? prev + "\n" : "") + errorMsg);
      message.error(errorMsg);
    } finally {
      stopScreenshot();
    }
  }, [
    hasScreenRecording,
    monitors,
    fetchMonitors,
    startScreenshot,
    stopScreenshot,
  ]); // Added dependencies

  // --- Helper to display status text ---
  const getStatusText = (status: boolean | null): string => {
    if (status === null) return "Checking...";
    return status ? "Granted ✅" : "Not Granted ❌";
  };

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      {/* Use Spin fullscreen for major loading states */}
      <Spin spinning={isCheckingPermissions || isTakingScreenshot} fullscreen />

      <h1>Screen Permissions & Screenshot (macOS)</h1>

      {/* Error Display */}
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
          Errors Encountered:\n{error}
        </pre>
      )}

      {/* Accessibility Permission Section */}
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
          {hasAccessibility ? "Permission Granted" : "Request Accessibility"}
        </Button>
        {hasAccessibility === false && (
          <p style={{ fontSize: "0.9em", color: "#555", marginTop: "5px" }}>
            Needed for some automation features.
          </p>
        )}
      </div>

      {/* Screen Recording Permission Section */}
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
          {hasScreenRecording
            ? "Permission Granted"
            : "Request Screen Recording"}
        </Button>
        {hasScreenRecording === false && (
          <p style={{ fontSize: "0.9em", color: "#555", marginTop: "5px" }}>
            Needed for screenshots and screen recording.
          </p>
        )}
      </div>

      <Divider />

      {/* Screenshot Section - Only relevant if permission granted */}
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
          type="primary" // Make it stand out
          onClick={handleTakeScreenshot}
          disabled={
            !hasScreenRecording || isTakingScreenshot || monitors.length === 0
          }
          loading={isTakingScreenshot}
          style={{ marginRight: "10px" }}
        >
          {isTakingScreenshot
            ? "Capturing..."
            : `Capture ${monitors.length > 0 ? monitors[0]?.name : "Monitor"}`}
        </Button>
        {!hasScreenRecording && (
          <span style={{ color: "orange" }}>
            Requires Screen Recording permission.
          </span>
        )}
        {hasScreenRecording &&
          monitors.length === 0 &&
          !isCheckingPermissions && (
            <span style={{ color: "orange" }}>Could not detect monitors.</span>
          )}

        {/* Screenshot Preview */}
        {screenshotUrl && (
          <div style={{ marginTop: "15px" }}>
            <h3>Screenshot Preview:</h3>
            <Image
              width={200} // Adjust preview size as needed
              src={screenshotUrl}
              alt="Screenshot Preview"
              placeholder={<Spin />} // Show spinner while image loads
            />
          </div>
        )}
      </div>

      <Divider />

      {/* Action Buttons */}
      <Button
        onClick={() => checkPermissions(true)}
        disabled={isCheckingPermissions}
        loading={isCheckingPermissions}
        style={{ marginRight: "10px" }}
      >
        Refresh Permissions
      </Button>
      <Button onClick={() => navigate(-1)}>Back</Button>
    </div>
  );
}

export default ScreenshotPage;
