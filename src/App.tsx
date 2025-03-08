// src/App.tsx
// Import routing components
import { Routes, Route } from "react-router-dom";
// Import page components
import GitHubAuth from "@/login/GitHubAuth";
import ScreenshotPage from "@/screenshot/ScreenshotPage"; // We will create this next
import "./App.css"; // Import your CSS file

function App() {
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
