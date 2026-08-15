# Aurora ✨

> 苹果质感 × Windows 原生体验的 DeepSeek 桌面工作台
> 一款开源、本地优先、能**真实干活**的 AI Agent 桌面应用

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" />
  <img src="https://img.shields.io/badge/Electron-43-47848F.svg" alt="Electron 43" />
  <img src="https://img.shields.io/badge/React-18-61DAFB.svg" alt="React 18" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6.svg" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/平台-Windows-0078D6.svg" alt="Windows" />
</p>

<p align="center">
  <img src="docs/screenshots/smoke-light.png" width="49%" alt="Aurora 浅色模式" />
  <img src="docs/screenshots/smoke-dark.png" width="49%" alt="Aurora 深色模式" />
</p>

**Aurora 不只是聊天窗口**：它内置一套真实执行的 Agent 工具链——模型说"写个文件"它就真的写进沙箱工作目录，说"跑段代码"它就真的跑，说"搜一下"它就联网搜索并附上引用来源。全部数据留在本机，API Key 用 Windows DPAPI 加密。

---

## ✨ 为什么选择 Aurora

| 对比 | 普通聊天客户端 | Aurora |
| --- | --- | --- |
| 工具执行 | ❌ 只会说不会做 | ✅ 文件/代码/命令/搜索真实执行，步骤可视化 |
| 知识库 | 无或需上传云端 | ✅ 本地 BM25 检索，文档永不出本机 |
| 扩展性 | 封闭 | ✅ MCP 客户端，接入任意工具生态 |
| 隐私 | 数据在云端 | ✅ 全本地 SQLite，每日自动备份 |
| 价格 | 订阅制 | ✅ 免费开源（MIT），自带 Key 按量付费 |
| 视觉 | 朴素 | ✅ 毛玻璃 + 深浅色 + 弹簧动画 + Win11 原生按钮 |

## ✨ 功能全景

### 🎨 界面与体验
- **Windows 11 风格窗口** + 苹果式毛玻璃三栏工作台，深浅色跟随系统
- **模式预设切换**：普通对话 / 编程助手 / 写作助手 / Agent 完整模式，一键切换系统提示词与工具组合，支持自定义模式
- **命令面板**（`Ctrl+K`）统一搜索会话、模型与动作；完整快捷键体系（`Ctrl+N` / `Ctrl+,` / `Ctrl+1~9` / `Ctrl+Shift+A` 全局唤起）
- **系统托盘常驻** + 后台完成系统通知（点击通知唤回窗口）
- 消息操作全家桶：编辑分支、重新生成、复制、错误重试、导出 Markdown/JSON
- Token 统计：首字延迟、总耗时、费用估算（DeepSeek 官方定价）+ **上下文用量指示器**（超 70% 橙、90% 红）

### 💬 对话核心
- 流式输出 + 可折叠思维链面板（deepseek-reasoner）
- Markdown 全渲染：GFM 表格、代码高亮（深浅双主题）+ 一键复制、KaTeX 公式
- **多模型管理**：DeepSeek 官方 + 任意 OpenAI 兼容端点；**测试连接后自动拉取端点模型列表，一键添加**（ccswitch 体验）
- 会话管理：SQLite 持久化、搜索、置顶、重命名、自动标题、每日自动备份
- 附件：图片多模态（兼容端点）、文本文件内联上下文
- 提示词系统：全局 + 会话级 + 模式三级系统提示词、内置模板库

### 🤖 Agent 工具（真实执行）
| 工具 | 说明 |
| --- | --- |
| `read_file` / `write_file` / `list_dir` | 工作目录沙箱文件操作，防路径越界 |
| `run_python` | 本机 Python 代码执行（30s 超时） |
| `run_shell` | 系统命令（确认弹窗 + 白名单 + `*` 通配） |
| `web_search` | 联网搜索（Bing 零配置解析，无 API Key 要求） |
| `fetch_url` | 网页抓取与正文提取 |
| `search_knowledge` | 本地知识库 RAG 检索（中文 bigram + BM25） |
| **MCP 客户端** | 接入任意 MCP stdio 服务器，工具并入 Agent 循环 |

工具调用过程以步骤卡片实时可视化（参数 / 状态 / 结果 / 引用来源），检查器右栏汇总展示。

### 🔒 隐私与安全
- 全部数据本地存储（SQLite），API Key DPAPI 加密
- 系统命令执行前强制确认，白名单可控
- 知识库检索全程本机，文档永不上传
- 每日自动备份（保留 7 份）
- 支持 HTTP 代理（模型请求 / 联网搜索 / 网页抓取全链路）

## 📦 安装

### 直接安装（Windows）
从 [Releases](../../releases) 下载 `Aurora Setup 0.1.0.exe`，双击安装即可。

### 从源码运行
```bash
# 环境要求：Node.js ≥ 20（Windows 10/11）
git clone https://github.com/Nothing-is-important/Aurora.git
cd aurora
npm install          # 中国网络可设置 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run dev          # 开发模式（Vite HMR + Electron）
npm run dist         # 打包 Windows 安装包（输出 release/）
```

## 🚀 快速上手（5 分钟）

1. 启动后点击左下角 **⚙ 设置**，在「DeepSeek Chat」粘贴 API Key → **测试连接** → 端点模型自动出现在下方，点一下即添加
2. 顶部左侧切换**模式**（编程 / 写作 / Agent），右侧选择模型
3. 开始对话；输入框下方实时显示上下文用量
4. 进阶玩法见 [📖 完整使用教程](docs/user-guide.md)（十三节，含工具/知识库/MCP 玩法）

> 没有 API Key？内置「本地演示（Mock）」模型可离线体验全部功能（含工具演示）。

## 🛠 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面框架 | Electron 43 |
| 前端 | React 18 + TypeScript + Tailwind CSS 3 + Vite 6 |
| 数据 | sql.js（SQLite wasm，零原生编译） |
| 渲染 | react-markdown + highlight.js + KaTeX |
| 检索 | 自研 BM25（中文 unigram+bigram 分词） |
| MCP | stdio JSON-RPC 客户端（自实现） |
| 打包 | electron-builder（NSIS） |

## 🧪 工程质量

- **12 阶段全自动冒烟审计**（`npm run smoke`）：像素采样 + DOM 断言 + 行为交互 + 真实执行验证（文件落盘 / Python 输出 / MCP echo / 剪贴板比对 / SQLite 断言），深浅色展示截图自动生成
- 40+ 提交的规范 git 历史，Conventional Commits，每轮迭代构建 + 审计 + 修复闭环

## 📁 项目结构

```
electron/    主进程（窗口、聊天 SSE 转发、工具执行器、MCP、知识库、DB、托盘）
src/         渲染层（三栏 UI、组件、hooks）
scripts/     开发脚本与内置 mock MCP 服务器
docs/        需求文档、变更日志、使用教程、截图
```

## 🗺 Roadmap

- [ ] 完整动态插件系统（DPS）：代码热定义 / 运行 / 停止，内置能力插件化管理
- [ ] 向量嵌入升级知识库检索（本地 ONNX 模型）
- [ ] macOS 适配
- [ ] i18n（中文 / English）

详见 [docs/roadmap.md](docs/roadmap.md)。

## 📄 License

[MIT](LICENSE) © Aurora Contributors

## 🙏 致谢

功能设计参考了开源社区方案：[deepseek-harness](https://github.com/HenryZ838978/deepseek-harness)、[Cherry Studio](https://docs.cherryai.com.cn/pre-basic/settings/key-shortcut) 等。
