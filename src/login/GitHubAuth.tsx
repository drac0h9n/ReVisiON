// src/login/GitHubAuth.tsx
import React from "react";
// Import useNavigate
import { useNavigate } from "react-router-dom";
import { useGitHubAuth } from "@/hooks/useGitHubAuth";
import { FaGithub } from "react-icons/fa";
import { FiLogOut, FiMail, FiUser, FiCamera } from "react-icons/fi"; // Added FiCamera

function GitHubAuth() {
  const { authState, userProfile, authError, login, logout } = useGitHubAuth();
  const navigate = useNavigate(); // Initialize navigate hook

  const goToScreenshotPage = () => {
    navigate("/screenshot"); // Navigate to the screenshot route
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden transition-all duration-300">
        {/* Header */}
        <div className="bg-indigo-600 dark:bg-indigo-700 px-6 py-4">
          <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
            <FaGithub className="text-2xl" />
            <span>GitHub Authentication</span>
          </h1>
        </div>

        {/* Content Area */}
        <div className="p-6">
          {/* Loading State */}
          {authState === "loading" && (
            // ... loading indicator ...
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
              <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-600 dark:text-gray-300 text-lg font-medium">
                Connecting to GitHub...
              </p>
            </div>
          )}

          {/* Error Message */}
          {authError && (
            // ... error display ...
            <div className="mb-6 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-4 rounded-md">
              {/* ... error content ... */}
              <div className="flex">
                <div className="flex-shrink-0">
                  {/* SVG Icon */}
                  <svg
                    className="h-5 w-5 text-red-500"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">
                    Authentication Error
                  </p>
                  <p className="mt-1 text-sm text-red-600 dark:text-red-500">
                    {authError}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Authenticated - Show User Profile AND Navigation Button */}
          {authState === "success" && userProfile && (
            <div className="flex flex-col items-center space-y-6">
              {/* ... user profile display ... */}
              <div className="relative">
                <img
                  src={userProfile.avatar_url}
                  alt={`${userProfile.login}'s avatar`}
                  className="w-24 h-24 rounded-full ring-4 ring-indigo-500 ring-offset-2 dark:ring-offset-gray-800"
                />
                {/* ... green checkmark ... */}
                <div className="absolute bottom-0 right-0 bg-green-500 p-1 rounded-full border-2 border-white dark:border-gray-800">
                  <svg
                    className="w-3 h-3 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              </div>
              <div className="text-center space-y-2">
                {/* ... name, username, email, id ... */}
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                  {userProfile.name || userProfile.login}
                </h2>
                <div className="flex items-center justify-center text-gray-500 dark:text-gray-400">
                  <FiUser className="mr-1" />
                  <span>@{userProfile.login}</span>
                </div>
                {userProfile.email && (
                  <div className="flex items-center justify-center text-gray-500 dark:text-gray-400">
                    <FiMail className="mr-1" />
                    <span>{userProfile.email}</span>
                  </div>
                )}
                <div className="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300 py-1 px-2 rounded-full inline-block">
                  ID: {userProfile.id}
                </div>
              </div>
              {/* ------- Action Buttons ------- */}
              <div className="w-full mt-6 space-y-3">
                {" "}
                {/* Container for buttons */}
                {/* --> NEW: Navigation Button <-- */}
                <button
                  onClick={goToScreenshotPage}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white transition-colors duration-300 font-medium py-2.5 px-4 rounded-lg"
                >
                  <FiCamera />
                  <span>Go to Screenshot Page</span>
                </button>
                {/* Sign Out Button */}
                <button
                  onClick={logout}
                  className="w-full flex items-center justify-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white transition-colors duration-300 font-medium py-2.5 px-4 rounded-lg"
                >
                  <FiLogOut />
                  <span>Sign Out</span>
                </button>
              </div>{" "}
              {/* End Action Buttons Container */}
            </div>
          )}

          {/* Not Logged In or Error - Show Login Button */}
          {(authState === "idle" || authState === "error") && (
            <div className="flex flex-col items-center space-y-4">
              {authState === "idle" && !authError && (
                <p className="text-gray-600 dark:text-gray-400">
                  Please sign in to continue.
                </p>
              )}
              {/* Only show login button if not loading */}
              <button
                onClick={login}
                className="w-full mt-2 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white transition-colors duration-300 font-medium py-3 px-4 rounded-lg"
              >
                <FaGithub className="text-xl" />
                <span>Login with GitHub</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default GitHubAuth;
