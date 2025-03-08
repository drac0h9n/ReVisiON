// src/screenshot/ScreenshotPage.tsx
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

// Assuming the API functions are available via this import
// Adjust the path if necessary (e.g., '../utils/macosPermissions')
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
  checkScreenRecordingPermission,
  requestScreenRecordingPermission,
} from "tauri-plugin-macos-permissions-api"; // <-- Make sure this path is correct for your project

function ScreenshotPage() {
  const navigate = useNavigate();

  // State for permission status (null = unchecked, true = granted, false = denied/error)
  const [hasAccessibility, setHasAccessibility] = useState<boolean | null>(
    null
  );
  const [hasScreenRecording, setHasScreenRecording] = useState<boolean | null>(
    null
  );

  // State for loading indicators
  const [isCheckingAccessibility, setIsCheckingAccessibility] = useState(false);
  const [isCheckingScreenRecording, setIsCheckingScreenRecording] =
    useState(false);
  const [isRequestingAccessibility, setIsRequestingAccessibility] =
    useState(false);
  const [isRequestingScreenRecording, setIsRequestingScreenRecording] =
    useState(false);

  // State for potential errors
  const [error, setError] = useState<string | null>(null);

  // --- Function to check both permissions ---
  const checkPermissions = useCallback(async (showLoading = false) => {
    setError(null); // Clear previous errors
    if (showLoading) {
      setIsCheckingAccessibility(true);
      setIsCheckingScreenRecording(true);
    }
    console.log("Checking permissions...");

    try {
      // Check Accessibility
      const accessGranted = await checkAccessibilityPermission();
      console.log("Accessibility Permission Status:", accessGranted);
      setHasAccessibility(accessGranted);
    } catch (err) {
      console.error("Error checking accessibility permission:", err);
      setError(
        `Failed to check accessibility permission: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      setHasAccessibility(false); // Treat error as 'not granted' for UI purposes
    } finally {
      if (showLoading) setIsCheckingAccessibility(false);
    }

    try {
      // Check Screen Recording
      const screenGranted = await checkScreenRecordingPermission();
      console.log("Screen Recording Permission Status:", screenGranted);
      setHasScreenRecording(screenGranted);
    } catch (err) {
      console.error("Error checking screen recording permission:", err);
      // Append error if one already exists
      setError((prev) =>
        prev
          ? `${prev}\nFailed to check screen recording permission: ${
              err instanceof Error ? err.message : String(err)
            }`
          : `Failed to check screen recording permission: ${
              err instanceof Error ? err.message : String(err)
            }`
      );
      setHasScreenRecording(false); // Treat error as 'not granted'
    } finally {
      if (showLoading) setIsCheckingScreenRecording(false);
    }
  }, []); // No dependencies needed for the function itself

  // --- Initial check on component mount ---
  useEffect(() => {
    checkPermissions(true); // Show loading indicator on initial check
  }, [checkPermissions]); // Depend on the memoized checkPermissions

  // --- Handler to request Accessibility Permission ---
  const handleRequestAccessibility = useCallback(async () => {
    if (hasAccessibility) return; // Already granted
    setIsRequestingAccessibility(true);
    setError(null);
    try {
      console.log("Requesting Accessibility permission...");
      await requestAccessibilityPermission();
      // After the request dialog closes, re-check the status
      console.log("Re-checking Accessibility permission after request...");
      const accessGranted = await checkAccessibilityPermission();
      setHasAccessibility(accessGranted);
      console.log("Accessibility status after request:", accessGranted);
      if (!accessGranted) {
        // Optional: Inform user they might need to manually grant in System Settings
        setError(
          "Accessibility permission was not granted. You may need to grant it manually in System Settings > Privacy & Security > Accessibility."
        );
      }
    } catch (err) {
      console.error(
        "Error requesting/re-checking accessibility permission:",
        err
      );
      setError(
        `Failed to request accessibility permission: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    } finally {
      setIsRequestingAccessibility(false);
    }
  }, [hasAccessibility]); // Depend on current status

  // --- Handler to request Screen Recording Permission ---
  const handleRequestScreenRecording = useCallback(async () => {
    if (hasScreenRecording) return; // Already granted
    setIsRequestingScreenRecording(true);
    setError(null);
    try {
      console.log("Requesting Screen Recording permission...");
      await requestScreenRecordingPermission();
      // After the request dialog closes, re-check the status
      console.log("Re-checking Screen Recording permission after request...");
      const screenGranted = await checkScreenRecordingPermission();
      setHasScreenRecording(screenGranted);
      console.log("Screen Recording status after request:", screenGranted);
      if (!screenGranted) {
        setError(
          "Screen Recording permission was not granted. You may need to grant it manually in System Settings > Privacy & Security > Screen Recording."
        );
      }
    } catch (err) {
      console.error(
        "Error requesting/re-checking screen recording permission:",
        err
      );
      setError(
        `Failed to request screen recording permission: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    } finally {
      setIsRequestingScreenRecording(false);
    }
  }, [hasScreenRecording]); // Depend on current status

  // --- Helper to display status text ---
  const getStatusText = (status: boolean | null, checking: boolean): string => {
    if (checking) return "Checking...";
    if (status === null) return "Unknown"; // Status before initial check finishes
    return status ? "Granted ✅" : "Not Granted ❌";
  };

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      <h1>Screen Permissions Check (macOS)</h1>
      {error && (
        <pre
          style={{
            color: "red",
            border: "1px solid red",
            padding: "10px",
            whiteSpace: "pre-wrap",
          }}
        >
          Error:\n{error}
        </pre>
      )}

      {/* Accessibility Permission Section */}
      <div
        style={{
          marginBottom: "25px",
          padding: "15px",
          border: "1px solid #eee",
          borderRadius: "5px",
        }}
      >
        <h2>Accessibility Permission</h2>
        <p>
          Status:{" "}
          <strong>
            {getStatusText(hasAccessibility, isCheckingAccessibility)}
          </strong>
        </p>
        <button
          onClick={handleRequestAccessibility}
          // Disable if granted, or while checking/requesting
          disabled={
            hasAccessibility === true ||
            isCheckingAccessibility ||
            isRequestingAccessibility
          }
        >
          {isRequestingAccessibility
            ? "Requesting..."
            : "Request Accessibility"}
        </button>
        {hasAccessibility === false && !isRequestingAccessibility && (
          <p style={{ fontSize: "0.9em", color: "#555", marginTop: "5px" }}>
            Required for certain automation features.
          </p>
        )}
      </div>

      {/* Screen Recording Permission Section */}
      <div
        style={{
          marginBottom: "25px",
          padding: "15px",
          border: "1px solid #eee",
          borderRadius: "5px",
        }}
      >
        <h2>Screen Recording Permission</h2>
        <p>
          Status:{" "}
          <strong>
            {getStatusText(hasScreenRecording, isCheckingScreenRecording)}
          </strong>
        </p>
        <button
          onClick={handleRequestScreenRecording}
          // Disable if granted, or while checking/requesting
          disabled={
            hasScreenRecording === true ||
            isCheckingScreenRecording ||
            isRequestingScreenRecording
          }
        >
          {isRequestingScreenRecording
            ? "Requesting..."
            : "Request Screen Recording"}
        </button>
        {hasScreenRecording === false && !isRequestingScreenRecording && (
          <p style={{ fontSize: "0.9em", color: "#555", marginTop: "5px" }}>
            Required for taking screenshots or recording the screen.
          </p>
        )}
      </div>

      {/* Refresh Button */}
      <button
        onClick={() => checkPermissions(true)}
        disabled={isCheckingAccessibility || isCheckingScreenRecording}
        style={{ marginRight: "10px" }}
      >
        {isCheckingAccessibility || isCheckingScreenRecording
          ? "Refreshing..."
          : "Refresh Permissions"}
      </button>

      {/* Back Button */}
      <button onClick={() => navigate(-1)}>Back</button>
    </div>
  );
}

export default ScreenshotPage;
