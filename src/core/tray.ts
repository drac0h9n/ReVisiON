// src/tray.ts
import { TrayIcon } from "@tauri-apps/api/tray";
import {
  Menu,
  MenuItem,
  Submenu,
  PredefinedMenuItem,
} from "@tauri-apps/api/menu";
import { hide } from "@tauri-apps/api/app"; // 隐藏整个应用（所有窗口）
import { listen, Event as TauriEvent, UnlistenFn } from "@tauri-apps/api/event";
import { Window } from "@tauri-apps/api/window"; // Import the Window class
import { exit, relaunch } from "@tauri-apps/plugin-process"; // Import from the process plugin
import { platform } from "@tauri-apps/plugin-os";

interface MenuItemPayload {
  id: string; // Menu item ID
}

// Use the label defined in tauri.conf.json under app.windows[].label
const mainWindowLabel = "main";
let mainWindow: Window | null = null; // Use the Window type

// Store unlisten function and tray instance
let unlistenMenuClick: UnlistenFn | null = null;
let trayIconInstance: TrayIcon | null = null;

/**
 * Initializes the system tray icon and menu using Tauri 2.0 APIs.
 * @returns Promise resolving to the unlisten function for menu events, or null on failure.
 */
export async function setupTray(): Promise<UnlistenFn | null> {
  if (unlistenMenuClick || trayIconInstance) {
    console.warn("Tray already initialized. Skipping setup.");
    return unlistenMenuClick;
  }

  console.log("Attempting to set up Tauri 2.0 tray...");

  try {
    // --- 1. Get Main Window Instance ---
    mainWindow = await Window.getByLabel(mainWindowLabel); // Use Window.getByLabel
    if (!mainWindow) {
      // Log warning but continue, maybe some actions don't need the window
      console.warn(
        `Could not get main window with label '${mainWindowLabel}'. Some tray actions might not work.`
      );
    }

    // --- 2. Get Tray Icon Instance ---
    const trayId = "main-tray"; // Ensure this ID matches tauri.conf.json > app.trayIcon.id
    trayIconInstance = await TrayIcon.getById(trayId);

    if (!trayIconInstance) {
      console.error(
        `Tray icon with id '${trayId}' not found. ` +
          `Ensure it is defined in tauri.conf.json under app.trayIcon ` +
          `and capabilities grant 'tray:allow-get-by-id' for this ID.`
      );
      return null; // Cannot proceed without the tray icon instance
    }
    console.log(`Successfully retrieved tray icon instance with ID: ${trayId}`);

    // --- 3. Create Menu Items (Using MenuItem) ---
    console.log("Creating menu items...");
    const toggleVisibilityItem = await MenuItem.new({
      // Use MenuItem directly
      id: "toggle_visibility",
      text: "显示/隐藏窗口",
      // accelerator: 'CmdOrCtrl+Shift+H', // You can add accelerators
      // enabled: mainWindow !== null, // Disable if window couldn't be found
    });
    const hideAppItem = await MenuItem.new({
      id: "hide_app",
      text: "隐藏应用", // Relevant mainly on macOS
    });
    const separator1 = await PredefinedMenuItem.new({ item: "Separator" });
    const relaunchItem = await MenuItem.new({
      id: "relaunch",
      text: "重新启动",
    });
    const separator2 = await PredefinedMenuItem.new({ item: "Separator" });
    const quitItem = await MenuItem.new({
      id: "quit",
      text: "退出",
      // accelerator: 'CmdOrCtrl+Q'
    });
    console.log("Menu items created.");

    // --- 4. Create Menu ---
    console.log("Creating menu...");
    const currentPlatform = await platform();
    const menuItems: (MenuItem | PredefinedMenuItem)[] = [toggleVisibilityItem];

    if ((currentPlatform as string) === "darwin") {
      // Keep direct comparison
      menuItems.push(hideAppItem);
    }
    menuItems.push(separator1, relaunchItem, separator2, quitItem);

    const trayMenu = await Menu.new({ items: menuItems });
    console.log("Menu created.");

    // --- 5. Set Menu on Tray Icon ---
    console.log("Setting menu on tray icon...");
    await trayIconInstance.setMenu(trayMenu);
    console.log("Menu set successfully.");

    // Optional: Set tooltip dynamically (if not set in config or needs update)
    // await trayIconInstance.setTooltip('My Awesome App is Running');

    // Optional: Control left click behavior (requires capability)
    // try {
    //     await trayIconInstance.setShowMenuOnLeftClick(false); // Default is true
    // } catch (e) {
    //     console.warn("Could not set showMenuOnLeftClick, maybe capability 'tray:allow-set-show-menu-on-left-click' is missing?", e);
    // }

    // --- 6. Listen for Menu Item Clicks ---
    console.log("Setting up menu item click listener...");
    unlistenMenuClick = await listen<MenuItemPayload>(
      "tauri://menu-item-clicked",
      async (event: TauriEvent<MenuItemPayload>) => {
        const menuId = event.payload?.id;
        console.log(`Menu item clicked (from src/tray.ts): ID=${menuId}`);

        if (!menuId) return;

        switch (menuId) {
          case "toggle_visibility":
            if (mainWindow) {
              try {
                const visible = await mainWindow.isVisible();
                console.log(`Window visibility: ${visible}. Toggling...`);
                if (visible) {
                  await mainWindow.hide();
                } else {
                  await mainWindow.show();
                  await mainWindow.setFocus(); // Bring to front after showing
                }
                console.log(`Window visibility toggled.`);
              } catch (winErr) {
                console.error(`Error toggling window visibility:`, winErr);
              }
            } else {
              console.warn(
                "Main window instance unavailable for 'toggle_visibility'."
              );
            }
            break;
          case "hide_app": // Primarily for macOS
            if ((currentPlatform as string) === "darwin") {
              try {
                console.log("Hiding application (macOS)...");
                await hide(); // Tauri's app hide function
                console.log("Application hidden.");
              } catch (e) {
                console.error("Failed to hide application:", e);
              }
            } else {
              console.log(
                "'Hide App' action called on non-macOS platform, likely no-op."
              );
              // Optionally, mimic hide by hiding the main window on other platforms
              // if (mainWindow) await mainWindow.hide();
            }
            break;
          case "relaunch":
            console.log("Relaunching application...");
            try {
              await relaunch(); // Uses plugin-process
              // Relaunch exits the current process, so no further code executes here
            } catch (relaunchErr) {
              console.error(`Error during relaunch:`, relaunchErr);
            }
            break;
          case "quit":
            console.log("Quitting application...");
            try {
              await exit(0); // Uses plugin-process
              // Exit terminates the process
            } catch (exitErr) {
              console.error(`Error during exit:`, exitErr);
            }
            break;
          default:
            console.log(`Unknown menu item clicked: ${menuId}`);
        }
      }
    );
    console.log("Menu item click listener attached.");

    console.log("Tauri 2.0 Tray setup complete (from src/tray.ts).");
    return unlistenMenuClick; // Return the cleanup function
  } catch (error) {
    console.error("------------------------------------------");
    console.error("FATAL: Failed to setup Tauri 2.0 tray icon:");
    console.error(error);
    console.error("------------------------------------------");
    console.error("Common causes:");
    console.error(
      "- Tray icon ID mismatch between tray.ts and tauri.conf.json."
    );
    console.error(
      "- Missing capabilities for 'tray:*' actions (check capabilities/default.json)."
    );
    console.error(
      "- Missing capabilities for 'window:*' actions (e.g., isVisible, show, hide)."
    );
    console.error(
      "- Missing capabilities for 'process:allow-exit', 'process:allow-restart'."
    );
    console.error("- Missing capability 'event:allow-listen' for menu clicks.");
    console.error(
      "- Icon file not found or invalid (check app.trayIcon.iconPath in config)."
    );
    console.error("- OS environment doesn't fully support system tray.");

    // Reset state on failure
    if (unlistenMenuClick) {
      unlistenMenuClick();
      unlistenMenuClick = null;
    }
    trayIconInstance = null;
    return null; // Indicate failure
  }
}

/**
 * Cleans up tray resources, primarily the event listener.
 */
export function cleanupTray() {
  if (unlistenMenuClick) {
    unlistenMenuClick();
    unlistenMenuClick = null;
    console.log("Unlistened from menu item events (from src/tray.ts).");
  }
  // No need to manually close the trayIconInstance if it was retrieved via getById
  // Tauri manages the lifecycle of tray icons defined in the config.
  // Only call .close() on instances created dynamically with TrayIcon.new() if needed before app exit.
  trayIconInstance = null; // Clear the reference
  console.log("Tray cleanup finished (from src/tray.ts).");
}
