import { DateTime, Str } from "chanfana";
import { z } from "zod";

export const Task = z.object({
  name: Str({ example: "lorem" }),
  slug: Str(),
  description: Str({ required: false }),
  completed: z.boolean().default(false),
  due_date: DateTime(),
});

// 原有的 Env 接口
export interface Env {
  DB: D1Database;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  JWT_SECRET: string;
  ENVIRONMENT: string;
}

// GitHub OAuth 令牌响应类型
export interface GitHubOAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

// GitHub 用户数据响应类型
export interface GitHubUserResponse {
  id: number;
  login: string;
  avatar_url: string;
  email: string | null;
  name: string | null;
}

// 用户类型
export interface User {
  id: number;
  username: string;
  email: string;
  avatar_url?: string;
}

// 自定义变量接口 - 用于 Hono Context
export interface Variables {
  accessToken: string;
  userId: number;
  user: User;
}

// GitHub 用户邮箱响应类型
export interface GitHubEmailResponse {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}
