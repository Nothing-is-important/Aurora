# Aurora v1.0.0 🎉

正式版发布。Aurora 现在以**开源 DeepSeek Harness 引擎**为内核，提供三种形态。

## 本版亮点

### 🚀 Aurora 原生客户端（全新，推荐）
进程内嵌入 DeepSeek Harness 引擎（无子进程，65 个引擎服务直连）+ 自绘苹果式玻璃 UI：

- **真引擎直连**：会话 / Agent 循环 / 工具执行 / 沙箱 / 审批 / 轨迹，全部由开源引擎驱动
- **模型供应商制**：填 API Key → 测速并获取模型列表（名称/上下文/上限）；模型菜单只显示已配置密钥的供应商；支持切换 DSH 数据目录复用已有密钥与会话
- **桌面全家桶**：命令面板（Ctrl+K）、快捷键、消息编辑/重新生成（引擎会话分叉）、导出 MD/JSON、23 个提示词模板、深浅色、托盘常驻、窗口状态记忆
- **引擎能力面板**：动态插件（官方 dynamicCordisRunner 定义/运行/停止）、MCP 组合配置、知识库 RAG（BM25 引擎工具 `kb_search`）、统计条
- 内置 dsh 运行时（开箱即用，无需 Node/dsh），40+ 断言冒烟审计（开发态 + 打包态全绿）

### 🖥 Aurora DSH 壳客户端
原生窗口/托盘/快捷键/崩溃自愈包裹官方 `dsh web`，100% 官方功能保底；图标换用 Aurora 图标，安装秒级。

### 🏛 Aurora 经典独立应用
早期独立实现（自制引擎 + 提供商预设），保留维护。

## 下载

| 文件 | 说明 |
| --- | --- |
| `Aurora-Setup-1.0.0.exe` | Aurora 原生客户端（推荐） |
| `Aurora-DSH-Setup-1.0.0.exe` | Aurora DSH 壳客户端（官方界面） |
| `Aurora Setup 1.0.0.exe` | Aurora 经典独立应用 |

全部为 Windows x64 NSIS 安装包，双击安装即用。

## 致谢

内核基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）。
