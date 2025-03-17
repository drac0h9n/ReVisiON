// src/app/layout.tsx
import { Outlet } from "react-router-dom";
import Sidebar from "@/components/layout/sidebar";

export default function RootLayout() {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
