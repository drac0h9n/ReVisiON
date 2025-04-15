// src/App.tsx
import GitHubAuth from "./login/GitHubAuth"; // Import the new component
// Removed unused imports: useGitHubAuth, icons, App.css
// Assuming global styles (like Tailwind) are imported in main.tsx or index.css
import "./App.css"; // Importing CSS for the App component

function App() {
  // App component is now much simpler
  // It just renders the GitHubAuth component
  // In a real app, this might involve routing logic later
  return (
    <div className="AppContainer">
      {" "}
      {/* Optional: Add a wrapper div if needed */}
      <GitHubAuth />
    </div>
  );
}

export default App;
