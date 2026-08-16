# Aurora × DeepSeek Harness 嵌入可行性报告（Route 1 PoC）

> 结论先行：**可行，PoC 已跑通**。Aurora 以「原生本地客户端」形态包裹 `dsh web`，
> 官方 Web 界面完整渲染在 Electron 无边框窗口中（见 `dsh-shell/poc-screenshot.png`
> 与 `dsh-shell/main.mjs`）。本报告给出架构依据、两种嵌入路线的取舍、风险清单与落地路线图。
>
> 📌 **历史注记（v1.0.2）**：Route 1 的壳客户端形态（`dsh-shell/`）已于 v1.0.2 删除——
> 正式路线改为 Route X「引擎进程内嵌入 + 自绘 Aurora UI」（`aurora-native/`），本报告仅作
> 架构取舍的历史记录保留。

---

## 1. PoC 验证结果（已实测通过）

在 `dsh-native` 分支的 `dsh-shell/` 下实现并跑通（`electron dsh-shell --smoke` 退出码 0）：

| 验证项 | 结果 |
| --- | --- |
| 启动 `dsh web --port 0`（真实 CLI，非复刻） | ✅ 解析 stdout `dsh web: http://127.0.0.1:<port>` 行拿到地址 |
| 全新 `DSH_HOME`（无任何预设数据） | ✅ 自动愈合 profiles/node_modules，正常启动 |
| Electron 无边框窗口加载该地址 | ✅ `frame:false + titleBarOverlay`（Windows 原生最小化/最大化/关闭按钮） |
| 官方 DSH Web 客户端完整渲染 | ✅ DOM 探测：标题「DeepSeek Harness」，含聊天输入框、侧栏、设置、工作区选择、模式切换、内测声明页 |
| 截图存证 | ✅ 1650×1020，98.4% 暗色像素 + 文字亮点，深色界面正常 |
| 退出时清理 | ✅ `taskkill /F /T` 同步杀 dsh 进程树，无孤儿端口残留 |

关键证据（DOM 探测输出）：

```
title: "DeepSeek Harness"
text: 新会话 工作区 暂无会话 设置 探索未至之境 预览版 选择工作区 标准模式 内测声明 …
textareas: 1, inputs: 1, buttons: 12
```

---

## 2. DSH 运行架构（嵌入依据）

阅读 `@deepseek-ai/dsh@0.1.0-rc.6`（本机 `F:\npm\node_modules\@deepseek-ai\dsh`）与
真实部署（`DSH_HOME=F:\.dsh`）后确认：

- **Profile = bundle 栈**：`$DSH_HOME/profiles/<name>/` 的 `package.json` 声明
  `dsh.profile.bundles` 有序列表。`web` profile = `dsh-base` + `dsh-web-app`；
  `headless` profile = `dsh-base` + `dsh-headless`（一次性任务，读完即退出）。
- **组合与启动**：CLI `lib/bin.js` → `runProfile()`（`dsh-app-boot` 的 `boot()`）：
  把各 bundle 的 cordis patch、用户 `cordis.patch.yml`、`--patch` 覆盖层按序合成，
  启动 Cordis 主机组合；**`runProfile` 不调用 `process.exit`**，进程生命周期完全
  交给挂载的插件（web 服务器常驻、headless 跑完调 `ctx.appExit`）。
- **Web 服务**：`dsh-web-app` 挂载 webserver + API 网关（Typert RPC over `/api`）+
  前端静态托管（发布包自带已构建 dist）；`--port 0` 由 OS 分配空闲端口，
  启动后向 stdout 打印 `dsh web: http://…` 行；`--trusted-host` 控制 `/api`
  信任围栏（同源加载无需放宽）。
- **数据落点**：会话、存储、凭据全部在 `DSH_HOME` 下；换一个 `DSH_HOME` 即得
  一套全新隔离环境（PoC 已验证）。

**结论**：`dsh web` 天生就是「本地服务 + Web 客户端」结构，正好是桌面壳包裹的
理想目标——这正是用户最初想要的：为 dsh web 做一个本地客户端。

---

## 3. 两条嵌入路线对比

### 路线 A：子进程壳（PoC 采用，推荐先行）

Electron 主进程 spawn `dsh web --port 0` → 解析 URL → BrowserWindow 加载。

| 维度 | 评价 |
| --- | --- |
| 稳定性 | ✅ 与 DSH 内部实现零耦合，唯一契约是「stdout 打印 URL 行」 |
| 版本跟随 | ✅ 用户侧 `npm i -g @deepseek-ai/dsh` 升级即升级；也可捆绑固定版本 |
| 进程模型 | ✅ DSH 引擎（含子代理 spawn、worker 线程）在独立 node 进程，与 Electron 隔离 |
| 崩溃隔离 | ✅ dsh 挂了可自动重启，Electron 不受影响；反之亦然 |
| 成本 | ⚠️ 需要机器上有 node + dsh（或 Aurora 安装包内置，见 §5） |

### 路线 B：进程内嵌入（可选进阶）

Aurora 把 `@deepseek-ai/dsh` 作为依赖，在 Electron 主进程 import
`profile-boot` 的 `runProfile()`，直接拿到 `ctx`（Cordis 根上下文），
进而可编程调用 `ctx.agents`、`ctx.sessions` 等服务，或让 Web 服务器绑定端口。

- **可行性依据**：`runProfile` 不占用进程退出；纯 ESM 无原生模块；
  需要自行提供 `cmdline`（`provideCmdline` 已导出）与 `appExit` 钩子
  （headless profile 文档明示「launcher-owned，宿主提供即可」）。
- **风险**：`installFailLoud` 会挂 process 错误处理器、SIGTERM/SIGINT 处理器，
  与 Electron 生命周期并存需谨慎；DSH rc 版本快速迭代，进程内升级=重发安装包；
  调试与崩溃面与 Electron 合流。
- **收益**：单进程、可直接用 Typert API 编程控制 Agent（为 Aurora 自绘 UI
  直连引擎铺路）；未来做「双 UI」切换（官方 Web / Aurora 自绘）时最灵活。

**建议**：先按路线 A 交付 v1；路线 B 作为 v2 的评估项（PoC 已验证 A 端到端）。

---

## 4. 风险清单与对策

| 风险 | 等级 | 对策 |
| --- | --- | --- |
| `printUrl` 行格式变化 | 低 | 解析器正则集中一处；备选 `--port <固定>` 并探活 `/` |
| 用户机器没有 dsh / node | 高 | 首次启动引导 `npm i -g @deepseek-ai/dsh`；或安装包 `extraResources` 内置 portable node + dsh 包（离线可用） |
| 与用户现有 dsh 部署冲突 | 中 | 默认独立 `DSH_HOME`（`%APPDATA%\Aurora\dsh-home`）；设置里可切换到 `F:\.dsh` 之类的已有部署复用真实会话 |
| `--host 0.0.0.0` 不支持 | 无 | 我们用 127.0.0.1 同源，正是官方推荐 |
| `/api` 信任围栏 | 低 | 同源加载天然通过；不注入第三方页面 |
| rc 版本 API 漂移 | 中 | 路线 A 下仅依赖 CLI 表面；升级回归用 PoC smoke 自动验证 |
| 子代理/worker 子进程 | 低 | 都在 dsh 的 node 进程树内，`taskkill /T` 一并清理（已实测） |
| 前端 dist 未构建 | 无 | 发布包自带已构建 dist（`dsh-web-frontend`） |

---

## 5. 落地路线图（dsh-native 分支）

1. **Phase 1 — 原生壳客户端（v1.0.0 目标）**
   - 窗口：无边框 + Windows 原生按钮（PoC 已用 `titleBarOverlay`）、
     窗口位置/尺寸记忆、最小化到托盘、开机自启可选
   - 生命周期：dsh 探活（URL 行 + HTTP 200）、崩溃自动重启（指数退避）、
     退出杀树、单实例锁
   - 外壳能力：托盘菜单、全局快捷键、系统通知桥接、中键/关闭行为
   - 分发：NSIS 安装包；首次运行检测 dsh，缺失则引导安装或内置
2. **Phase 2 — 品牌与深度整合**
   - 通过 DSH 客户端插件（`dsh-client-ui-theme` 等 40+ `dsh-client-ui-*` 包）
     注入 Aurora 主题/品牌，保持官方 UI 但带 Aurora 观感
   - Aurora 侧「模型/会话」数据面板直接读 `DSH_HOME` 的 SQLite/JSONL
3. **Phase 3 — 路线 B 评估**：进程内嵌入 + 自绘 UI 直连 Typert API，
   与现有 Aurora 应用（独立路线）合流，形成「官方 Web / Aurora 自绘」双模式

---

## 6. 与现有 Aurora 应用的关系

- `main` 分支的 Aurora 独立应用继续作为 Release 产品线；
- `dsh-native` 的壳客户端是用户最初诉求的本体——「为 dsh web 整一个本地客户端」；
- 两者共享：打包/发布流水线（gh CLI + Release）、冒烟审计框架、窗口状态管理代码；
- 正式发布 1.0.0 待壳客户端 Phase 1 完成（按既定规则：每提交递增版本号 + git tag）。
