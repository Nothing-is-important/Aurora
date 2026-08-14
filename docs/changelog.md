# Aurora 变更日志

## 第 4 轮 · 设置中心 + 附件 + 打包 ✅（进行中）

- **设置中心弹窗**（苹果风双栏）：模型列表 + 编辑表单（名称/提供方/Base URL/API Key/模型 ID/温度/Max Tokens/Top P/启用开关）
- 支持添加/删除自定义模型、**连接测试**（请求 `/models` 端点，8 秒超时，返回端点模型数）
- API Key 密码框可显示切换，DPAPI 加密存储
- **附件**：文件选择对话框（图片/文本/代码类型识别）、输入区缩略图/文件芯片、删除
- 图片附件以 `image_url` 多模态部分发送（仅 OpenAI 兼容端点，DeepSeek 官方不支持视觉）；文本附件内联进上下文（<200KB）
- 依赖瘦身：渲染层依赖全部走 Vite 打包，运行时仅 sql.js → 减小安装包
- 应用图标：System.Drawing 生成渐变星芒 icon（512px）
- electron-builder NSIS 打包配置（非 oneClick、可选安装目录、桌面/开始菜单快捷方式）

## 第 3 轮 · 会话管理 ✅（完成）

- **数据层**：会话/消息 CRUD（conversations/messages 表），消息 upsert 自动刷新会话 updated_at，旧库 error 列迁移
- **自动标题**：首条消息前 24 字自动生成会话标题
- **useChat 会话化**：发送时落库（用户+助手行先行写入再启动流）、流式增量防抖持久化、切换会话从 SQLite 重载、事件订阅全局化（切走不丢流）
- **侧边栏**：真实会话列表（置顶优先 + 时间排序）、相对时间显示、双击重命名（Enter 保存/Esc 取消）、悬停置顶/删除、搜索过滤、空状态
- **冒烟第三阶段**：自动创建第二会话 → 切换（验证清空）→ 切回（验证 4 条恢复）→ 主进程直查 SQLite 断言落盘
- **修复关键竞态**：新建会话时 activeId 触发的 load 与 send 的落库赛跑，读到半成品数据导致消息重复——方案：新建会话跳过 load（send 自行填充）+ 加载代际守卫（过期 load 丢弃）

### 第 3 轮审计结果
- 三阶段全绿：停止截断 ✅ / 会话切换恢复 4 条 ✅ / DB 落盘（2 会话 4 消息，含思维链与代码内容）✅
- 侧边栏 2 项、标题栏自动标题、搜索框、零控制台错误 ✅

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
