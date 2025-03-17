# LLM Chatbot 桌面应用 - 技术参考文档

## 项目概述

这是一个基于 Tauri 2.0 的 LLM 聊天机器人桌面应用，使用 React 和 TypeScript 作为前端技术栈，结合 Shadcn UI 组件库构建用户界面。应用支持多种聊天模式、历史记录管理、用户认证等功能。

## 技术栈

- **Tauri 2.0**: 跨平台桌面应用框架
- **React**: 前端 UI 框架
- **TypeScript**: 类型安全的 JavaScript 超集
- **React Router**: 路由管理
- **Tailwind CSS**: 实用优先的 CSS 框架
- **Shadcn UI**: 基于 Radix UI 和 Tailwind CSS 的组件库
- **Lucide React**: 图标库

## 项目结构

```
revision/
├── src/
│   ├── App.tsx              # 主应用路由配置
│   ├── main.tsx             # 应用入口点
│   ├── index.css            # 全局样式和Tailwind配置
│   ├── lib/
│   │   └── utils.ts         # 工具函数(cn等)
│   ├── components/
│   │   ├── ui/              # Shadcn UI组件
│   │   ├── chat/            # 聊天相关组件
│   │   │   ├── message.tsx  # 消息气泡组件
│   │   │   └── chat-input.tsx # 聊天输入框组件
│   │   └── layout/
│   │       └── sidebar.tsx  # 侧边栏导航组件
│   └── app/                 # 页面组件
│       ├── page.tsx         # 首页(欢迎页)
│       ├── layout.tsx       # 应用主布局
│       ├── (auth)/          # 认证相关页面
│       │   ├── login/       # 登录页面
│       │   └── register/    # 注册页面
│       ├── chat/            # 聊天页面
│       │   ├── [id]/        # 特定聊天会话
│       │   └── new/         # 新建聊天
│       ├── settings/        # 设置页面
│       ├── history/         # 历史记录页面
│       ├── profile/         # 用户资料页面
│       ├── topics/          # 主题选择页面
│       ├── feedback/        # 反馈页面
│       └── help/            # 帮助中心页面
└── src-tauri/               # Tauri后端代码
    ├── Cargo.toml           # Rust依赖配置
    └── tauri.conf.json      # Tauri配置
```

## 主要配置文件

### tailwind.config.js

```js
module.exports = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    // 颜色、组件主题、动画等配置
  },
  plugins: [require("tailwindcss-animate")],
};
```

### package.json 主要依赖

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.x",
    "lucide-react": "^0.x",
    "class-variance-authority": "^0.x",
    "clsx": "^2.x",
    "tailwind-merge": "^1.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tailwindcss": "^3.x",
    "postcss": "^8.x",
    "autoprefixer": "^10.x",
    "@shadcn/ui": "^0.x"
  }
}
```

## 核心功能模块

1. **用户认证系统**

   - 登录/注册功能
   - 用户会话管理

2. **聊天系统**

   - 实时对话界面
   - 多轮对话支持
   - 上下文理解

3. **导航与布局**

   - 侧边栏导航
   - 响应式布局

4. **设置与个性化**

   - 主题切换
   - 语言设置
   - AI 回答长度调整

5. **历史与数据管理**

   - 对话历史查看与搜索
   - 数据清理选项

6. **专业领域支持**
   - 多种聊天主题选择
   - 专业化回答模式

## Shadcn UI 组件使用

项目使用以下 Shadcn UI 组件:

```bash
# 已安装的UI组件
- button
- card
- input
- textarea
- avatar
- select
- switch
- separator
- accordion
- label
```

## 开发命令

```bash
# 安装依赖
npm install

# 开发模式运行
npm run tauri dev

# 构建应用
npm run tauri build
```

## 应用自定义样式

应用使用了基于蓝色(#3B82F6)的主题，色彩系统通过 CSS 变量在`src/index.css`中定义:

```css
:root {
  --primary: 221.2 83.2% 53.3%;
  --primary-foreground: 210 40% 98%;

  /* 其他颜色变量... */
}
```

## 路由结构

```
/                # 首页/欢迎页
/login           # 用户登录
/register        # 用户注册
/chat/new        # 新建聊天
/chat/:id        # 特定聊天会话
/settings        # 应用设置
/history         # 历史记录
/profile         # 用户资料
/topics          # 主题选择
/feedback        # 反馈页面
/help            # 帮助中心
```

这个文档提供了项目的核心技术栈和结构概览，为开发者提供了快速了解和上手项目的参考。
