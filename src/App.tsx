// src/App.tsx
import React from "react";
import { useGitHubAuth } from "./hooks/useGitHubAuth";
import { FaGithub } from "react-icons/fa";
import { FiLogOut, FiMail, FiUser } from "react-icons/fi";
import "./App.css";

function App() {
  const { authState, userProfile, authError, login, logout } = useGitHubAuth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden transition-all duration-300">
        {/* 头部 */}
        <div className="bg-indigo-600 dark:bg-indigo-700 px-6 py-4">
          <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
            <FaGithub className="text-2xl" />
            <span>GitHub Authentication</span>
          </h1>
        </div>

        {/* 内容区域 */}
        <div className="p-6">
          {/* 加载状态 */}
          {authState === "loading" && (
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
              <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-600 dark:text-gray-300 text-lg font-medium">
                Connecting to GitHub...
              </p>
            </div>
          )}

          {/* 错误消息 */}
          {authError && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-4 rounded-md">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg
                    className="h-5 w-5 text-red-500"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {authError}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 认证成功，显示用户信息 */}
          {authState === "success" && userProfile && (
            <div className="flex flex-col items-center space-y-6">
              <div className="relative">
                <img
                  src={userProfile.avatar_url}
                  alt={`${userProfile.login}'s avatar`}
                  className="w-24 h-24 rounded-full ring-4 ring-indigo-500 ring-offset-2 dark:ring-offset-gray-800"
                />
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

              <button
                onClick={logout}
                className="w-full mt-6 flex items-center justify-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white transition-colors duration-300 font-medium py-2.5 px-4 rounded-lg"
              >
                <FiLogOut />
                <span>Sign Out</span>
              </button>
            </div>
          )}

          {/* 未登录或出错时，显示登录按钮 */}
          {(authState === "idle" || authState === "error") && (
            <button
              onClick={login}
              className="w-full mt-2 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white transition-colors duration-300 font-medium py-3 px-4 rounded-lg"
            >
              <FaGithub className="text-xl" />
              <span>Login with GitHub</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
