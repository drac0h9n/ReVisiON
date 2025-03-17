// src/App.tsx
import { Routes, Route } from "react-router-dom";
import RootLayout from "@/app/layout";
import HomePage from "@/app/page";
import LoginPage from "@/app/(auth)/login/page";
import RegisterPage from "@/app/(auth)/register/page";
import ChatPage from "@/app/chat/[id]/page";
import NewChatPage from "@/app/chat/new/page";
import SettingsPage from "@/app/settings/page";
import HistoryPage from "@/app/history/page";
import ProfilePage from "@/app/profile/page";
import TopicsPage from "@/app/topics/page";
import FeedbackPage from "@/app/feedback/page";
import HelpPage from "@/app/help/page";

function App() {
  return (
    <Routes>
      <Route path="/" element={<RootLayout />}>
        <Route index element={<HomePage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="chat/new" element={<NewChatPage />} />
        <Route path="chat/:id" element={<ChatPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="topics" element={<TopicsPage />} />
        <Route path="feedback" element={<FeedbackPage />} />
        <Route path="help" element={<HelpPage />} />
      </Route>
    </Routes>
  );
}

export default App;
