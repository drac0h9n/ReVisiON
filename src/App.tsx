import React, { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener"; // Correct plugin import
import "./App.css";

type AuthState = "idle" | "loading" | "success" | "error";

interface GitHubProfile {
  login: string;
  id: number;
  name?: string;
  avatar_url: string;
  email?: string;
}

function App() {
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [userProfile, setUserProfile] = useState<GitHubProfile | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Refs to store unlisten functions for cleanup
  const unlistenSuccessRef = useRef<UnlistenFn | null>(null);
  const unlistenErrorRef = useRef<UnlistenFn | null>(null);

  // Setup event listeners on component mount
  useEffect(() => {
    let isMounted = true; // Flag to prevent state updates on unmounted component

    const setupListeners = async () => {
      try {
        const successListener = await listen<{
          token: string;
          profile: GitHubProfile;
        }>("github_auth_success", (event) => {
          if (isMounted) {
            console.log("GitHub Auth Success Event:", event.payload);
            setUserProfile(event.payload.profile);
            setAuthState("success");
            setAuthError(null);
          }
        });

        const errorListener = await listen<any>( // Use 'any' or a specific error type if defined
          "github_auth_error",
          (event) => {
            if (isMounted) {
              console.error("GitHub Auth Error Event:", event.payload);
              let errorMessage = "Authentication failed. Please try again.";
              // Try to extract a more specific message from the Rust error enum payload
              if (event.payload && typeof event.payload === "object") {
                const errorKey = Object.keys(event.payload)[0]; // e.g., "ReqwestError", "GitHubError"
                if (errorKey && typeof event.payload[errorKey] === "string") {
                  errorMessage = `${errorKey}: ${event.payload[errorKey]}`;
                } else if (errorKey) {
                  errorMessage = `Authentication failed: ${errorKey}`;
                }
              } else if (typeof event.payload === "string") {
                errorMessage = event.payload;
              }

              setAuthError(errorMessage);
              setAuthState("error");
              setUserProfile(null);
            }
          }
        );

        // Store unlisten functions in refs
        unlistenSuccessRef.current = successListener;
        unlistenErrorRef.current = errorListener;

        console.log("Auth event listeners attached.");
      } catch (error) {
        console.error("Failed to setup auth listeners:", error);
        if (isMounted) {
          setAuthError("Failed to initialize authentication listeners.");
          setAuthState("error");
        }
      }
    };

    setupListeners();

    // Cleanup function
    return () => {
      isMounted = false; // Mark component as unmounted
      console.log("Cleaning up auth listeners...");
      if (unlistenSuccessRef.current) {
        unlistenSuccessRef.current();
        console.log("Success listener detached.");
      }
      if (unlistenErrorRef.current) {
        unlistenErrorRef.current();
        console.log("Error listener detached.");
      }
    };
  }, []); // Empty dependency array ensures this runs only on mount and unmount

  // Function to trigger the GitHub login flow
  const handleGitHubLogin = useCallback(async () => {
    setAuthState("loading");
    setAuthError(null);
    setUserProfile(null);

    try {
      console.log("Invoking login_with_github command...");
      const authUrl = await invoke<string>("login_with_github"); // Expecting string URL on success
      console.log("Received auth URL:", authUrl);

      // Open the URL in the user's default browser using the plugin
      await openUrl(authUrl);
      console.log(
        "GitHub auth URL opened via plugin. Waiting for callback and events..."
      );
      // Don't set state back to 'idle' here, wait for success/error events
    } catch (error: any) {
      console.error("Failed to initiate GitHub login or open URL:", error);
      // This catches errors from invoke itself or openUrl,
      // not errors during the async OAuth flow (handled by events)
      setAuthError(`Failed to start login process: ${error?.message || error}`);
      setAuthState("error");
    }
  }, []); // useCallback ensures the function identity is stable if needed

  // Optional: Simple logout function (clears local state)
  const handleLogout = () => {
    setUserProfile(null);
    setAuthState("idle");
    setAuthError(null);
    console.log("User logged out (client-side state cleared).");
  };

  return (
    <div className="container">
      <h1>Tauri GitHub Auth Test</h1>

      {authState === "loading" && <p>Logging in, please wait...</p>}

      {authError && <p className="error-message">Error: {authError}</p>}

      {authState === "success" && userProfile && (
        <div className="profile">
          <h2>Welcome!</h2>
          <img
            src={userProfile.avatar_url}
            alt={`${userProfile.login}'s avatar`}
            width="80"
            height="80"
            style={{ borderRadius: "50%" }}
          />
          <p>ID: {userProfile.id}</p>
          <p>Login: {userProfile.login}</p>
          {userProfile.name && <p>Name: {userProfile.name}</p>}
          {userProfile.email && <p>Email: {userProfile.email}</p>}
          <button onClick={handleLogout}>Logout</button>
        </div>
      )}

      {(authState === "idle" || authState === "error") && (
        // 移除 disabled 属性，或者根据需要设置其他条件
        <button onClick={handleGitHubLogin}>Login with GitHub</button>
      )}
    </div>
  );
}

export default App;
