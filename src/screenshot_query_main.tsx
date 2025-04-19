import React from "react";
import ReactDOM from "react-dom/client";
import QueryComponent from "@/screenshot/query"; // 假设你的组件默认导出或命名导出为 QueryComponent

const container = document.getElementById("root");
if (container) {
  const root = ReactDOM.createRoot(container);
  root.render(
    <React.StrictMode>
      <QueryComponent />
    </React.StrictMode>
  );
} else {
  console.error("Failed to find the root element for screenshot query window.");
}
