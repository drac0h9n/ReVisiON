// src/screenshot/ScreenshotPage.tsx
import React from "react";
import { useNavigate } from "react-router-dom"; // Import useNavigate for navigation
import { FiArrowLeft } from "react-icons/fi"; // Icon for back button

function ScreenshotPage() {
  const navigate = useNavigate(); // Hook to get navigation function

  const handleGoBack = () => {
    navigate("/"); // Navigate back to the main page (login/profile)
  };

  return (
    // Use similar background and centering as the login page for consistency
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex flex-col items-center justify-center p-4 relative">
      {/* Back Button - Placed top-left for usual convention */}
      <button
        onClick={handleGoBack}
        className="absolute top-4 left-4 md:top-6 md:left-6 flex items-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white transition-colors duration-300 font-medium py-2 px-4 rounded-lg shadow"
        aria-label="Go back to profile"
      >
        <FiArrowLeft />
        <span>Back</span>
      </button>

      {/* Main Content */}
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-800 dark:text-white mb-4">
          Screenshot Feature
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-300">ScreenTest</p>
        {/* Add more screenshot related UI elements here later */}
      </div>
    </div>
  );
}

export default ScreenshotPage;
