// src/screenshot/ScreenshotPage.tsx
import { useState, useEffect, useCallback, useRef } from "react";
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
import {
  register,
  unregister,
  isRegistered,
} from "@tauri-apps/plugin-global-shortcut"; // Import isRegistered

const SCREENSHOT_HOTKEY = "CmdOrCtrl+Shift+S";
// 添加防抖时间常量
const MESSAGE_DEBOUNCE_MS = 300;

type ScreenshotHandler = (source: "button" | "hotkey") => Promise<void>;

function ScreenshotPage() {
  const navigate = useNavigate();

  // Refs
  const didLogHotkeyActive = useRef(false);
  const latestHandleTakeScreenshot = useRef<ScreenshotHandler>(async () => {});
  const isProcessingHotkey = useRef(false);
  const activeMsgTimeoutIdRef = useRef<NodeJS.Timeout | null>(null);
  const didShowRegistrationErrorRef = useRef(false);
  // --- NEW Ref to indicate if registration is currently in progress ---
  const isRegisteringRef = useRef(false);
  // --- NEW Ref for message debounce ---
  const lastMessageTimestampRef = useRef<number>(0);

  // --- State ---
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

  // --- Functions ---
  const fetchMonitors = useCallback(async () => {
    // ... (Function remains the same)
    console.log("[Fn] Fetching monitors...");
    try {
      const fetchedMonitors = await getScreenshotableMonitors();
      setMonitors(fetchedMonitors);
      console.log("[Fn] Monitors fetched:", fetchedMonitors.length);
    } catch (err) {
      console.error("[Fn] Error fetching monitors:", err);
      setError(
        (prev) => (prev ? prev + "\n" : "") + `Monitor fetch failed: ${err}`
      );
      setMonitors([]);
    }
  }, []);

  const checkPermissions = useCallback(
    async (showLoading = false) => {
      // ... (Function remains the same)
      console.log("[Fn] Checking permissions...");
      setError(null);
      if (showLoading) startChecking();
      let screenGranted: boolean | null = null;
      let accessibilityGranted: boolean | null = null;
      try {
        console.log("[Fn] Checking Accessibility...");
        accessibilityGranted = await checkAccessibilityPermission();
        setHasAccessibility(accessibilityGranted);

        console.log("[Fn] Checking Screen Recording...");
        screenGranted = await checkScreenRecordingPermission();
        setHasScreenRecording(screenGranted);

        console.log(
          `[Fn] Permissions Checked: Accessibility=${accessibilityGranted}, Screen=${screenGranted}`
        );

        if (screenGranted) {
          console.log("[Fn] Screen permission granted, fetching monitors...");
          await fetchMonitors();
        } else {
          console.log("[Fn] Screen permission not granted, clearing monitors.");
          setMonitors([]);
        }
      } catch (err) {
        console.error("[Fn] Permission check failed:", err);
        setError(
          (prev) =>
            (prev ? prev + "\n" : "") + `Permission check failed: ${err}`
        );
        setHasAccessibility(false);
        setHasScreenRecording(false);
        setMonitors([]);
      } finally {
        if (showLoading) stopChecking();
        console.log("[Fn] Permission check finished.");
      }
    },
    [startChecking, stopChecking, fetchMonitors]
  );

  useEffect(() => {
    // ... (Initial permission check effect remains the same)
    console.log("[Effect] Initial permission check effect runs.");
    checkPermissions(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkPermissions]);

  const handleRequestAccessibility = useCallback(async () => {
    // ... (Function remains the same)
    if (hasAccessibility === true) return;
    console.log("[Fn] Requesting Accessibility permission...");
    setIsRequestingAccessibility(true);
    try {
      await requestAccessibilityPermission();
      const granted = await checkAccessibilityPermission();
      setHasAccessibility(granted);
      console.log("[Fn] Accessibility request result:", granted);
      message[granted ? "success" : "warning"](
        granted ? "Accessibility granted!" : "Accessibility needed."
      );
    } catch (err) {
      console.error("[Fn] Accessibility request failed:", err);
      message.error(`Accessibility request failed: ${err}`);
    } finally {
      setIsRequestingAccessibility(false);
    }
  }, [hasAccessibility]);

  const handleRequestScreenRecording = useCallback(async () => {
    // ... (Function remains the same)
    if (hasScreenRecording === true) return;
    console.log("[Fn] Requesting Screen Recording permission...");
    setIsRequestingScreenRecording(true);
    try {
      await requestScreenRecordingPermission();
      const granted = await checkScreenRecordingPermission();
      setHasScreenRecording(granted);
      console.log("[Fn] Screen Recording request result:", granted);
      if (granted) {
        message.success("Screen Recording granted!");
        await fetchMonitors();
      } else {
        message.warning("Screen Recording needed.");
        setMonitors([]);
      }
    } catch (err) {
      console.error("[Fn] Screen Recording request failed:", err);
      message.error(`Screen Recording request failed: ${err}`);
    } finally {
      setIsRequestingScreenRecording(false);
    }
  }, [hasScreenRecording, fetchMonitors]);

  const handleTakeScreenshot = useCallback(
    async (source: "button" | "hotkey" = "button") => {
      console.log(`[Fn] handleTakeScreenshot triggered by: ${source}`);
      if (isTakingScreenshot) {
        console.warn(
          `[Fn] Screenshot action (${source}) ignored: isTakingScreenshot state is true.`
        );
        return;
      }
      let currentScreenPermission: boolean;
      try {
        console.log("[Fn] Checking screen permission before screenshot...");
        currentScreenPermission = await checkScreenRecordingPermission();
        console.log("[Fn] Screen permission status:", currentScreenPermission);
      } catch (permError) {
        console.error(
          "[Fn] Permission check failed before screenshot:",
          permError
        );
        message.error("Permission check failed before screenshot.");
        return;
      }

      if (!currentScreenPermission) {
        setHasScreenRecording(false);
        console.warn("[Fn] Screen recording permission required.");
        message.error(
          "Screen recording permission required to take screenshot."
        );
        return;
      }
      if (!hasScreenRecording) setHasScreenRecording(true);

      let currentMonitors = monitors;
      if (currentMonitors.length === 0) {
        console.log("[Fn] No monitors in state, attempting fetch...");
        try {
          let attempt = 0;
          while (currentMonitors.length === 0 && attempt < 2) {
            attempt++;
            console.log(`[Fn] Fetch attempt ${attempt}...`);
            currentMonitors = await getScreenshotableMonitors();
          }

          if (currentMonitors.length === 0) {
            console.error("[Fn] No monitors detected even after re-fetching.");
            message.error("No monitors detected even after re-fetching.");
            return;
          }
          console.log(
            "[Fn] Monitors fetched successfully before screenshot:",
            currentMonitors.length
          );
          setMonitors(currentMonitors);
        } catch (fetchErr) {
          console.error(
            "[Fn] Failed to fetch monitors before screenshot:",
            fetchErr
          );
          message.error(
            `Failed to fetch monitors before screenshot: ${fetchErr}`
          );
          return;
        }
      }

      const primaryMonitor = currentMonitors[0];
      if (!primaryMonitor) {
        console.error("[Fn] Primary monitor not found.");
        message.error("Primary monitor not found in the available list.");
        return;
      }

      console.log(
        `[Fn] Attempting screenshot (${source}) on monitor: ${primaryMonitor.name}`
      );
      startScreenshot();
      setScreenshotUrl(null);

      try {
        const filePath = await getMonitorScreenshot(primaryMonitor.id);
        console.log("[Fn] Screenshot captured to path:", filePath);
        const assetUrl = convertFileSrc(filePath);
        console.log("[Fn] Converted file src:", assetUrl);
        const finalUrl = `${assetUrl}?t=${Date.now()}`;
        setScreenshotUrl(finalUrl);

        // 添加消息防抖逻辑
        const now = Date.now();
        if (now - lastMessageTimestampRef.current > MESSAGE_DEBOUNCE_MS) {
          message.success(`Screenshot captured! (${source})`);
          lastMessageTimestampRef.current = now;
          console.log(`[Fn] Screenshot success message shown for ${source}.`);
        } else {
          console.log(
            `[Fn] Skipping duplicate success message (${source}) due to debounce.`
          );
        }
      } catch (err) {
        const errorMsg = `Screenshot Failed (${source}): ${
          err instanceof Error ? err.message : String(err)
        }`;
        console.error("[Fn]", errorMsg, err);
        setError((prev) => (prev ? prev + "\n" : "") + errorMsg);
        message.error("Screenshot failed.");
        setScreenshotUrl(null);
      } finally {
        stopScreenshot();
        console.log(`[Fn] Screenshot process finished for ${source}.`);
      }
    },
    [
      isTakingScreenshot,
      monitors,
      hasScreenRecording,
      fetchMonitors,
      startScreenshot,
      stopScreenshot,
    ]
  );

  useEffect(() => {
    // ... (Effect to update latestHandleTakeScreenshot ref remains the same)
    console.log("[Effect] Updating latestHandleTakeScreenshot ref.");
    latestHandleTakeScreenshot.current = handleTakeScreenshot;
  }, [handleTakeScreenshot]);

  // Register and Unregister Global Hotkey Effect
  useEffect(() => {
    console.log("[Effect] Hotkey registration effect runs (mount/remount).");
    let isHotkeyCurrentlyRegisteredInThisEffect = false; // Track registration state *within this effect run*

    const hotkeyCallback = () => {
      if (isProcessingHotkey.current) {
        console.warn(
          `[Hotkey Callback] Ignored: Already processing previous hotkey press.`
        );
        return;
      }
      try {
        isProcessingHotkey.current = true;
        console.log(
          `[Hotkey Callback] ${SCREENSHOT_HOTKEY} pressed, lock acquired.`
        );
        latestHandleTakeScreenshot
          .current("hotkey")
          .catch((handlerError) => {
            console.error(
              "[Hotkey Callback] Error during handleTakeScreenshot execution:",
              handlerError
            );
          })
          .finally(() => {
            isProcessingHotkey.current = false;
            console.log(
              "[Hotkey Callback] Processing finished, lock released."
            );
          });
      } catch (error) {
        console.error("[Hotkey Callback] Unexpected synchronous error:", error);
        isProcessingHotkey.current = false;
      }
    };

    const manageHotkeyRegistration = async () => {
      // Prevent concurrent registration attempts (e.g., from rapid StrictMode runs)
      if (isRegisteringRef.current) {
        console.log(
          "[Effect] Registration already in progress, skipping this attempt."
        );
        return;
      }
      isRegisteringRef.current = true;
      console.log("[Effect] Starting hotkey registration management.");

      // Clear any pending "active" message from previous attempts
      if (activeMsgTimeoutIdRef.current) {
        clearTimeout(activeMsgTimeoutIdRef.current);
        activeMsgTimeoutIdRef.current = null;
      }

      // --- **Defensive Unregister** ---
      try {
        // Check if it *thinks* it's registered before trying to unregister
        // This reduces unnecessary calls when we know it shouldn't be registered
        const potentiallyRegistered = await isRegistered(SCREENSHOT_HOTKEY);
        if (potentiallyRegistered) {
          console.log(
            `[Effect] Attempting defensive unregister for ${SCREENSHOT_HOTKEY} as it might be lingering...`
          );
          await unregister(SCREENSHOT_HOTKEY);
          console.log(`[Effect] Defensive unregister successful.`);
        } else {
          console.log(
            `[Effect] Skipping defensive unregister: ${SCREENSHOT_HOTKEY} is not currently registered.`
          );
        }
      } catch (err: any) {
        // Log unexpected errors during the defensive unregister attempt
        console.warn(
          `[Effect] Error during defensive unregister/check (but proceeding):`,
          err
        );
      }
      // --- **End Defensive Unregister** ---

      // --- **Attempt Registration** ---
      try {
        console.log(
          `[Effect] Attempting to register hotkey: ${SCREENSHOT_HOTKEY}`
        );
        await register(SCREENSHOT_HOTKEY, hotkeyCallback);
        isHotkeyCurrentlyRegisteredInThisEffect = true; // Mark success *for this effect's cleanup*
        console.log(
          `[Effect] Hotkey ${SCREENSHOT_HOTKEY} registered successfully.`
        );

        // Schedule "active" message (if not shown before in lifecycle)
        if (!didLogHotkeyActive.current) {
          console.log("[Effect] Scheduling hotkey active message...");
          activeMsgTimeoutIdRef.current = setTimeout(() => {
            console.log("[Effect] Showing delayed hotkey active message.");
            message.info(`Screenshot hotkey (${SCREENSHOT_HOTKEY}) active.`, 2);
            didLogHotkeyActive.current = true;
            activeMsgTimeoutIdRef.current = null;
          }, 100);
        }
      } catch (err) {
        console.error(
          `[Effect] Failed to register hotkey ${SCREENSHOT_HOTKEY}:`,
          err
        );
        isHotkeyCurrentlyRegisteredInThisEffect = false; // Mark failure

        // Cancel pending "active" message
        if (activeMsgTimeoutIdRef.current) {
          clearTimeout(activeMsgTimeoutIdRef.current);
          activeMsgTimeoutIdRef.current = null;
        }

        // Show error message (once per mount cycle)
        if (!didShowRegistrationErrorRef.current) {
          message.error(`Hotkey ${SCREENSHOT_HOTKEY} may be in use.`);
          didShowRegistrationErrorRef.current = true;
        } else {
          console.warn(
            `[Effect] Suppressed duplicate registration error message for ${SCREENSHOT_HOTKEY}.`
          );
        }
      } finally {
        // --- Release registration lock ---
        isRegisteringRef.current = false;
        console.log("[Effect] Hotkey registration management finished.");
      }
    };

    manageHotkeyRegistration();

    // Cleanup Function
    return () => {
      console.log("[Effect Cleanup] Hotkey registration effect cleanup START.");

      // Clear pending "active" message
      if (activeMsgTimeoutIdRef.current) {
        clearTimeout(activeMsgTimeoutIdRef.current);
        activeMsgTimeoutIdRef.current = null;
        console.log("[Effect Cleanup] Cleared pending active message.");
      }

      // Unregister *only if this specific effect run successfully registered it*
      if (isHotkeyCurrentlyRegisteredInThisEffect) {
        console.log(
          `[Effect Cleanup] Attempting to unregister ${SCREENSHOT_HOTKEY} (registered by this effect instance).`
        );
        // We use a separate async function for unregister logic if needed complex handling,
        // but fire-and-forget is common in cleanup. Adding check before unregister.
        const unregisterTask = async () => {
          try {
            if (await isRegistered(SCREENSHOT_HOTKEY)) {
              await unregister(SCREENSHOT_HOTKEY);
              console.log(
                `[Effect Cleanup] Unregister command for ${SCREENSHOT_HOTKEY} sent successfully.`
              );
            } else {
              console.log(
                `[Effect Cleanup] Unregister skipped: ${SCREENSHOT_HOTKEY} was already unregistered.`
              );
            }
          } catch (err) {
            console.error(
              `[Effect Cleanup] Failed to unregister ${SCREENSHOT_HOTKEY}:`,
              err
            );
          } finally {
            // Resetting isProcessingHotkey here might be too early if unregister is truly async
            // Let the unmount effect handle it.
          }
        };
        unregisterTask(); // Fire off the unregister task
      } else {
        console.log(
          `[Effect Cleanup] Skipping unregister: Hotkey was not registered by this specific effect instance.`
        );
      }
      console.log("[Effect Cleanup] Hotkey registration effect cleanup END.");
    };
  }, []); // Empty dependency array

  // Effect to Reset Flags on TRUE Unmount
  useEffect(() => {
    return () => {
      console.log(
        "[Effect Cleanup] Component truly unmounting. Resetting flags and ensuring unregistration."
      );
      // Reset flags
      didLogHotkeyActive.current = false;
      didShowRegistrationErrorRef.current = false;
      isProcessingHotkey.current = false; // Reset hotkey lock
      isRegisteringRef.current = false; // Reset registration lock
      // 重置消息防抖时间戳
      lastMessageTimestampRef.current = 0;

      // Clear any lingering timeout
      if (activeMsgTimeoutIdRef.current) {
        clearTimeout(activeMsgTimeoutIdRef.current);
        activeMsgTimeoutIdRef.current = null;
      }

      // --- **Final Unregistration Attempt** ---
      // This acts as a final safeguard on true unmount, regardless of
      // the state of isHotkeyCurrentlyRegisteredInThisEffect from the other effect.
      console.log(
        `[Effect Cleanup] Performing final unregistration check/attempt for ${SCREENSHOT_HOTKEY} on true unmount.`
      );
      const finalUnregister = async () => {
        try {
          if (await isRegistered(SCREENSHOT_HOTKEY)) {
            await unregister(SCREENSHOT_HOTKEY);
            console.log(`[Effect Cleanup] Final unregister successful.`);
          } else {
            console.log(
              `[Effect Cleanup] Final unregister unnecessary: not registered.`
            );
          }
        } catch (err) {
          console.error(
            `[Effect Cleanup] Error during final unregister attempt:`,
            err
          );
        }
      };
      finalUnregister(); // Fire and forget final attempt
    };
  }, []); // Empty dependency array ensures cleanup runs only on true unmount

  // --- Helper ---
  const getStatusText = (status: boolean | null): string => {
    if (status === null) return "Checking...";
    return status ? "Granted ✅" : "Not Granted ❌";
  };

  // --- Render ---
  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      {/* ... (rest of the JSX remains the same) ... */}
      {isCheckingPermissions && (
        <Spin style={{ position: "absolute", top: "10px", right: "10px" }} />
      )}
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
            maxHeight: "150px",
            overflowY: "auto",
          }}
        >
          Errors Encountered:{"\n"}
          {error}
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
          {hasAccessibility ? "Granted" : "Request"}
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
          {hasScreenRecording ? "Granted" : "Request"}
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
          disabled={!hasScreenRecording || isTakingScreenshot}
          loading={isTakingScreenshot}
          style={{ marginRight: "10px" }}
        >
          {isTakingScreenshot
            ? "Capturing..."
            : `Capture ${
                monitors.length > 0 ? monitors[0]?.name : "Primary Monitor"
              }`}
        </Button>
        {!hasScreenRecording && (
          <span style={{ color: "orange", marginLeft: "10px" }}>
            Requires Screen Recording permission.
          </span>
        )}
        {hasScreenRecording === true &&
          monitors.length === 0 &&
          !isCheckingPermissions &&
          !isTakingScreenshot && (
            <span style={{ color: "orange", marginLeft: "10px" }}>
              Could not detect monitors initially. Try refreshing or check
              system settings.
            </span>
          )}
        {screenshotUrl && (
          <div style={{ marginTop: "15px" }}>
            <h3>Screenshot Preview:</h3>
            <Image
              key={screenshotUrl}
              width={300}
              src={screenshotUrl}
              alt="Screenshot Preview"
              placeholder={<Spin tip="Loading Preview..." size="large" />}
              style={{ border: "1px solid #ccc", maxWidth: "100%" }}
              preview={false}
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
        style={{ marginRight: "10px" }}
      >
        Refresh Permissions
      </Button>
      <Button onClick={() => navigate(-1)}>Back</Button>
    </div>
  );
}

export default ScreenshotPage;
