# Aurora ✨

> 苹果质感 × Windows 原生体验的 DeepSeek 桌面工作台
> 以 **DeepSeek Harness 开源引擎**为内核的本地 Agent 客户端

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" />
  <img src="https://img.shields.io/badge/Electron-43-47848F.svg" alt="Electron 43" />
  <img src="https://img.shields.io/badge/React-18-61DAFB.svg" alt="React 18" />
  <img src="https://img.shields.io/badge/引擎-DeepSeek%20Harness-4D6BFE.svg" alt="DeepSeek Harness" />
  <img src="https://img.shields.io/badge/平台-Windows-0078D6.svg" alt="Windows" />
</p>

**Aurora 不是又一个聊天壳**：它把开源 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 引擎**进程内嵌入** Electron 主进程，用自绘的苹果式玻璃 UI 直连引擎 API——会话、Agent 循环、工具执行、沙箱、审批、轨迹、动态插件、知识库，全部由真引擎驱动；同时保留 Aurora 全套桌面体验（命令面板、提示词模板、提供商预设、导出、托盘、快捷键）。

---

## 📦 三个形态

| 形态 | 目录 | 说明 |
| --- | --- | --- |
| **Aurora 原生客户端**（主力） | `aurora-native/` | 进程内嵌入 Harness 引擎 + 自绘 Aurora UI，单进程、开箱即用 |
| **Aurora DSH 壳客户端**（保底） | `dsh-shell/` | 原生窗口/托盘/快捷键包裹官方 `dsh web` 界面，100% 官方功能 |
| **Aurora 独立应用**（经典） | 仓库根目录 | 早期独立实现的 Aurora（自制引擎 + 提供商预设），保留在 `main` 分支 |

两个新客户端都**自带 dsh 运行时**（首个安装包内是单文件 zip，首启自动解压到 `%LOCALAPPDATA%\Aurora DSH\runtime`，两应用共享、损坏自愈），无需自行安装 Node 或 dsh。

---

## ✨ 功能全景（Aurora 原生客户端）

### 🎨 界面与体验
- Windows 11 风格无边框窗口 + 苹果式毛玻璃三栏工作台，深浅色切换
- **命令面板**（`Ctrl+K`）统一搜索会话、模型与操作；快捷键：`Ctrl+N` 新对话、`Ctrl+,` 设置、`Ctrl+Shift+A` 全局唤起
- **系统托盘常驻**：关闭最小化到托盘、双击唤起、启动最小化可选
- 窗口位置/尺寸记忆；单实例锁
- 消息操作全家桶：**编辑/重新生成（引擎会话分叉）**、复制、导出 Markdown / 导出 JSON（原始事件流）
- 统计条：`X 轮 · Y 步 · LLM 2m48s · 工具 1m2s`（会话事件流折叠，与官方 sessionStats 同口径）

### 💬 对话核心
- 流式输出 + 思维链折叠面板；Markdown 全渲染（GFM 表格、代码高亮、KaTeX 公式、一键复制）
- **模型供应商制**：DeepSeek 官方 + 任意可配置供应商；配置 API Key → **测速并获取模型列表**（名称/上下文窗口/输出上限）；左上角模型菜单只显示已配置密钥的供应商
- 会话管理：引擎持久化（SQLite 查询 + JSONL 日志）、历史会话列表、自动标题
- **提示词模板库**（23 个）：翻译/润色/会议纪要/周报/需求拆解…一键插入
- **DSH 数据目录可切换**：指向已有部署（如 `F:\.dsh`）直接复用其 API Key 与会话

### 🤖 引擎能力（DeepSeek Harness 直连）
| 能力 | 说明 |
| --- | --- |
| Agent 循环 | 引擎原生多步 Agent（工具调用→结果回传→继续），65 个引擎服务全部可编程调用 |
| 工具/沙箱/审批 | 文件读写、Shell、代码执行、联网搜索、Readonly/Write/Full 权限预设、审批弹窗 |
| **动态插件** | 官方 `dynamicCordisRunner`：代码热定义 → 运行 → 停止，插件工具并入 Agent 循环 |
| **MCP 服务器** | `cordis.patch.yml` 组合级配置，保存即重启生效 |
| **知识库 RAG** | 本地文件夹 → BM25 索引（中文单字+双字分词），注册为引擎工具 `kb_search`，模型自动引用你的资料 |
| 轨迹/统计 | 会话事件流（轮次/步/工具调用/用量）全量落日志，轨迹视图由引擎提供 |

### 🔒 隐私与安全
- 全部数据本地存储（DSH_HOME 数据目录 + 应用数据目录）
- API Key 存引擎凭据库（`.credentials.yaml`），与官方 Web 端同一存储
- 系统命令执行受引擎沙箱与审批策略约束
- 知识库检索全程本机，文档永不上传

---

## 📥 安装

从 [Releases](../../releases) 下载最新版安装包（Windows x64，NSIS）：

- `Aurora-Setup-1.0.0.exe` —— **Aurora 原生客户端**（推荐）
- `Aurora-DSH-Setup-1.0.0.exe` —— Aurora DSH 壳客户端（官方界面）

双击安装即可，**无需安装 Node / dsh**（运行时内置）。

## 🚀 快速上手

1. 启动 → 右上角 ⚙ 设置 → DeepSeek 填入 API Key → 保存 → **测速并获取模型**
2. 左上角选择模型（只显示已配置密钥的供应商）
3. 开始对话；需要引用自己的资料 → 设置 → 知识库 → 添加文件夹
4. 有现成 dsh 部署？设置 → DSH 数据目录填 `F:\.dsh` → 应用（直接复用其密钥与会话）

## 🛠 从源码运行

```bash
git clone https://github.com/Nothing-is-important/Aurora.git
cd aurora

# Aurora 原生客户端
cd aurora-native
npm install            # 中国网络可设 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run build          # 构建渲染层
node scripts/pack-runtime.mjs   # 打包内置运行时（先下载便携 node 到 .node-portable.zip）
npm run smoke          # 冒烟审计

# Aurora DSH 壳客户端
cd ../dsh-shell
node smoke.mjs         # 双场景冒烟审计
```

## 🧪 工程质量

- **全自动冒烟审计**（两应用合计 40+ 断言）：引擎启动/会话生命周期/模型目录/凭据往返/密钥过滤/单次点击切换/命令面板/模板填充/分叉通路/动态插件全流程/MCP 重启/知识库检索/窗口状态/托盘/截图存证——每轮迭代构建 + 审计 + 修复闭环
- 打包态（win-unpacked）冒烟 + 静默安装计时测试
- 运行时哨兵校验自愈、共享运行时跨应用复用、图标字节级验证

## 📁 项目结构

```
aurora-native/   Aurora 原生客户端（electron/ 引擎桥 + src/ 自绘 UI + kb/BM25）
dsh-shell/       Aurora DSH 壳客户端（dsh 生命周期/托盘/崩溃自愈 + 官方 Web UI）
electron/ src/   经典独立应用（main 分支，v0.9 系列）
docs/            需求、变更日志、使用教程、DSH 嵌入可行性报告、截图
scripts/         构建与测试脚本
```

## 🗺 Roadmap

- [x] 引擎进程内嵌入 + 自绘 UI 直连（v1.0）
- [x] 命令面板/快捷键/编辑分支/导出/模板
- [x] 动态插件/MCP/统计条/知识库 RAG
- [ ] 向量嵌入升级知识库检索（本地 ONNX 模型）
- [ ] macOS 适配
- [ ] i18n（中文 / English）

## 📄 License

[MIT](LICENSE) © Aurora Contributors

## 🙏 致谢

内核基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）；功能设计参考了开源社区方案：[Cherry Studio](https://docs.cherryai.com.cn) 等。
