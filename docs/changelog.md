# Aurora 变更日志

## 第 1 轮 · 项目骨架（进行中）

- 初始化 Electron + React 18 + TypeScript + Vite 6 + Tailwind 3 工程
- Electron 主进程：无边框窗口、交通灯 IPC、nativeTheme 主题桥接、冒烟截图模式
- 预加载脚本：contextBridge 安全桥（窗口/主题/冒烟信号）
- React 渲染层：三栏工作台（毛玻璃侧边栏 + 对话区 + 检查器面板）
- 苹果风视觉：氛围光斑背景、玻璃材质、交通灯悬停符号、弹簧缓动、Inter 字体
- 深浅色主题：跟随系统 + 手动循环切换（system → light → dark）
- 冒烟测试框架：`npm run smoke` 自动截图浅/深色并捕获控制台错误
