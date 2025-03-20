// src/types/auth.ts

// User interface
export interface User {
  id: string;
  username: string;
  email: string | null;
  avatarUrl?: string;
}

// Authentication states
export enum AuthStatus {
  INITIAL = "INITIAL",
  AUTHENTICATING = "AUTHENTICATING",
  AUTHENTICATED = "AUTHENTICATED",
  UNAUTHENTICATED = "UNAUTHENTICATED",
}

// Authentication state interface for Zustand store
export interface AuthState {
  status: AuthStatus;
  user: User | null;
  error: string | null;
  isLoading: boolean;

  // State transition methods
  initAuth: () => void;
  startAuth: () => void;
  setAuthenticated: (user: User) => void;
  setUnauthenticated: (error?: string) => void;
  logout: () => void;
  refreshUserInfo: () => void;
}

// GitHub OAuth related interfaces
export interface GitHubAuthResponse {
  url: string; // GitHub OAuth URL to redirect to
}

export interface GitHubCallbackParams {
  code: string;
  state: string;
}

// Session management interfaces
export interface SessionInfo {
  expiresAt?: number;
  refreshToken?: string;
}

// API error responses
export interface AuthError {
  message: string;
  code?: string;
  status?: number;
}
