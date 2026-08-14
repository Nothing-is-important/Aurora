# Aurora 变更日志

## 第 2 轮 · 聊天核心 ✅（完成）

- **SQLite 存储层**（sql.js，零原生编译）：settings / models / conversations / messages 四表，防抖持久化到 `%APPDATA%\aurora\aurora.db`
- API Key 用 Windows DPAPI（safeStorage）加密存储
- **主进程聊天服务**：OpenAI 兼容 SSE 流式转发（content / reasoning_content / usage 分事件推送）、AbortController 停止、HTTP 错误透传
- **Mock 提供方**：无需网络与 Key 的本地模拟流（含思维链/代码块/公式），供演示与测试
- 内置三个模型配置：Mock / DeepSeek Chat / DeepSeek Reasoner（Key 在设置中配置）
- **渲染层**：useChat 状态机（流式增量/停止/错误/usage）、模型下拉菜单（配置状态指示灯）、思维链折叠面板（思考动画）、流式光标、停止按钮（红方块）、错误卡片
- **Markdown 全渲染**：react-markdown + GFM + 表格，代码块语法高亮（双主题自定义 hljs 配色）+ 复制按钮，KaTeX 行内/块级公式
- **冒烟审计升级为两阶段**：① 完整流式 Mock 对话（验证思维链/高亮/公式/复制）② 流式中途点击停止（验证截断生效、不进入错误态）
- 修复：sql.js SqlValue 类型兼容、db 类型收窄问题

### 第 2 轮审计结果
- 中途停止：stoppedEarly=true, errored=false ✅
- DOM：思维链/代码块/hljs/KaTeX/复制按钮全部就位，结束后停止按钮消失，零控制台错误 ✅
- SQLite 落盘 36KB ✅

## 第 1 轮 · 项目骨架 ✅（完成）

- 初始化 Electron 43 + React 18 + TypeScript + Vite 6 + Tailwind 3 工程
- Electron 主进程：无边框窗口、交通灯 IPC、nativeTheme 主题桥接
- 预加载脚本：contextBridge 安全桥（窗口/主题）
- React 渲染层：三栏工作台（毛玻璃侧边栏 264 + 对话区 + 检查器 300）
- 苹果风视觉：氛围光斑背景、玻璃材质、交通灯悬停符号、弹簧缓动、Inter 字体
- 深浅色主题：跟随系统 + 手动循环切换（system → light → dark）
- **数值化冒烟审计框架**：像素采样（交通灯颜色/亮度/方差）+ DOM 布局断言，自动截图存 `shots/` 供人工查看
- 环境适配：绕过失效本地代理直连 npm，Electron 二进制走 npmmirror 镜像
- 修复：冒烟模式下主进程主题被渲染层覆盖的问题（getSource 泄漏）

### 第 1 轮审计结果
- 浅色平均亮度 0.91 / 深色 0.11，主题切换生效 ✅
- 交通灯红 146 / 黄 139 / 绿 161 像素命中 ✅
- 布局 264 / 718 / 300，标题栏 44px，无水平溢出，零控制台错误 ✅
