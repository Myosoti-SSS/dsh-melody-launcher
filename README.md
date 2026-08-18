<div align="center">

<img src="public/launcher-icon.png" alt="dsh-旋律启动器" width="128" />

# dsh-旋律启动器

**面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Windows 桌面启动器与插件管理器**

一个下载即用的启动器：管理 DSH 本体、插件、API Key 与运行配置，无需预装 Node.js。

<br />

[![CI](https://img.shields.io/github/actions/workflow/status/rirko/dsh-melody-launcher/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=CI)](https://github.com/rirko/dsh-melody-launcher/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/rirko/dsh-melody-launcher?style=for-the-badge&logo=github&color=6C7BFF)](https://github.com/rirko/dsh-melody-launcher/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/rirko/dsh-melody-launcher/total?style=for-the-badge&logo=windows&logoColor=white&color=0078D6)](https://github.com/rirko/dsh-melody-launcher/releases)
[![Stars](https://img.shields.io/github/stars/rirko/dsh-melody-launcher?style=for-the-badge&logo=github&color=FFB020)](https://github.com/rirko/dsh-melody-launcher/stargazers)
[![Issues](https://img.shields.io/github/issues/rirko/dsh-melody-launcher?style=for-the-badge&logo=github&color=FF6B6B)](https://github.com/rirko/dsh-melody-launcher/issues)

[![Electron](https://img.shields.io/badge/Electron-33-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-2-6E9F18?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2020-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64%20%7C%20arm64-0078D6?style=flat-square&logo=windows&logoColor=white)](https://github.com/rirko/dsh-melody-launcher/releases/latest)

**简体中文** · [English](README.en.md)

<br />

<img src="public/launcher-background.png" alt="dsh-旋律启动器" width="820" />

</div>

---

## 目录

- [这是什么](#这是什么)
- [核心特性](#核心特性)
- [快速开始](#快速开始)
- [使用指南](#使用指南)
- [DSH 本体检测与安装](#dsh-本体检测与安装)
- [Node.js 便携运行时](#nodejs-便携运行时)
- [数据与配置](#数据与配置)
- [安全设计](#安全设计)
- [从源码运行](#从源码运行)
- [项目结构](#项目结构)
- [开发路线图](#开发路线图)
- [常见问题](#常见问题)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

---

## 这是什么

**dsh-旋律启动器**是一个 Windows 桌面应用，把 DeepSeek Harness（DSH）的下载、部署、插件管理和启动流程收拢到一个图形界面里。交互方式参考《我的世界》**忘却的旋律启动器**：在真正启动之前，先在一个地方把运行配置、API Key、插件启停和加载顺序都安排妥当。

它解决的是这样一类问题：

| 原本要做的事 | 用启动器之后 |
| --- | --- |
| 装 Node.js → 装 npm → `npx @deepseek-ai/dsh` | 下载一个 exe，点「下载安装 DSH」 |
| 手改 `.credentials.yaml` 填 API Key | 界面里输入，自动写入并设为 0600 权限 |
| 翻 GitHub 找插件、手敲 `dsh plugin add` | 内置搜索 `dsh-plugin` Topic，一键安装 |
| 编辑 profile 的 `package.json` 调加载顺序 | 拖动列表，直接改官方 Profile |
| 开终端、记命令、盯输出 | 一个按钮启动，实时日志面板 |

> [!NOTE]
> **整合包（Modpack）功能已可用。** 支持把一组插件与配置保存、导入和导出为可复用的整合包。欢迎一起开发 —— QQ：**1250104511**

---

## 核心特性

### 部署与启动

- **零依赖首次部署** —— 未检测到本地 DSH 时，首页主按钮自动切换为「下载安装 DSH」，一键完成部署
- **自动准备 Node.js** —— 系统没有 Node.js 也能用：自动从 Node.js 官网下载便携运行时，SHA-256 校验，支持断点续传
- **自动准备 pnpm** —— 首次管理插件时安装启动器专用的 pnpm，不依赖系统全局命令，并统一提供给普通安装、整合包与 AI 尝试模式
- **多路径 DSH 检测** —— 依次检查启动器运行目录、当前启动配置、`PATH`、`%APPDATA%\npm` 和系统 Node.js 目录
- **进程生命周期管理** —— 启动、停止、实时日志（stdout/stderr 分级），停止或退出启动器时同步收尾 DSH 及由启动器拉起的伴随进程
- **自动打开网页** —— 从日志中识别本地服务地址并自动在浏览器打开（可关闭）

### 统一资源市场与插件管理

- **统一发现** —— 并行检索 [`dsh-plugin`](https://github.com/topics/dsh-plugin)、[`dsh-skill`](https://github.com/topics/dsh-skill) 与 `dsh-app`，在同一列表中浏览和搜索
- **内容识别** —— Topic 只作为候选来源；检测后按真实仓库内容标记为 `Plugin`、`Skill`、`应用加载项`、`Agent 预设`、混合资源、`DSH 本体` 或 `无效`
- **按标签安装** —— Plugin 进入目标 Profile，Skill 与预设写入各自目录；应用加载项使用独立运行目录，混合仓库由用户明确选择组件
- **应用加载项管理** —— 支持替代 Web 启动、DSH 启动后伴随运行和独立应用三种模式；与同仓库 Plugin 协同时同步启停
- **聚合仓库支持** —— 可展开 Git 子模块组成的资源套件，并从固定 revision 或 Release 资产安装 Plugin、Skill 与 Agent 预设
- **严格 Skill 校验** —— 检查目录型 `<name>/SKILL.md` 或单文件 `<name>.md`，YAML frontmatter 必须包含 kebab-case 的 `name` 与非空 `description`
- **分阶段安装进度** —— `准备 → 解析 → 下载 → 配置 → 完成` 五个阶段，带百分比与实时状态文本
- **加载顺序编排** —— 直接读写 DSH 官方 Profile，调整启用状态与 Bundle 加载顺序
- **停用 ≠ 卸载** —— 停用只把插件移出有序加载列表，本地依赖保留，可随时恢复；只有显式卸载才删除
- **核心 Bundle 保护** —— `@deepseek-ai/dsh-base`、`dsh-web-app`、`dsh-headless` 三个核心组合层在主进程层面禁止停用，界面上也不提供卸载入口
- **构建脚本自动授权** —— 遇到 pnpm `ERR_PNPM_IGNORED_BUILDS` 时，仅为当前安装的仓库批准构建脚本并自动重试

### 界面与配置

- **双尺寸窗口** —— 无边框设计，启动模式（900×560）与管理模式（1380×860）自由切换
- **GitHub 账号登录** —— 支持 OAuth Device Flow 与 Fine-grained Token，凭据使用 Electron 安全存储加密；市场搜索、仓库检测、下载与更新检查统一携带认证
- **API 管理** —— 在软件内配置 DeepSeek API Key，也可添加 OpenAI Completions、OpenAI Responses 或 Anthropic Messages 兼容的自定义服务
- **启动器自更新** —— 启动时检查 GitHub Release，可在界面下载并应用新版便携程序
- **完整运行配置** —— `DSH_HOME`、Profile 名称、工作目录、启动命令与参数，均可在界面调整
- **便携版** —— 启动器自身无需安装，单文件 exe

---

## 快速开始

### 1. 下载

前往 [**Releases**](https://github.com/rirko/dsh-melody-launcher/releases/latest) 下载最新的 `DSH-Launcher-*-portable.exe`。

> [!IMPORTANT]
> 便携版目前**未使用商业代码签名证书**。首次运行时 Windows SmartScreen 可能提示来源未知 —— 请确认文件确实来自本仓库 Release 页面后，选择「更多信息 → 仍要运行」。

### 2. 首次部署

打开启动器。如果没有检测到本地 DSH，首页主按钮会显示 **「下载安装 DSH」**，点击即可完成首次部署。

整个过程**不需要预先安装 DSH、Node.js、npm 或 npx** —— 缺什么启动器就准备什么。请保持网络连接；下载中断后重新点击可继续。

### 3. 配置 API Key

在启动页填入 DeepSeek API Key。启动器会写入 DSH 官方凭据文件 `$DSH_HOME/.credentials.yaml`。

### 4. 安装 Plugin 或 Skill（可选）

进入「**资源市场**」搜索候选仓库，检测真实类型后安装 Plugin 或 Skill。Plugin 可在「**插件顺序**」中调整启用状态与加载顺序。

### 5. 启动

回到启动页点击 **「启动 DSH」**。服务就绪后会自动打开 Harness 网页。

---

## 通过 npm 安装

如果你已经安装了 Node.js，也可以通过 npm 直接运行启动器：

```powershell
# 直接运行，不需要先安装
npx dsh-melody-launcher

# 或全局安装后运行
npm install -g dsh-melody-launcher
dsh-melody-launcher
```

> [!NOTE]
> 该方式会通过 npm 安装 Electron 运行时，首次启动可能需要下载 Electron 二进制。
> 目前仅支持 Windows。

---

## 使用指南

启动器有三个主要视图：

### 插件顺序

展示当前 Profile 中的全部 Bundle。每个插件可以：

- **启用 / 停用** —— 切换开关即从有序加载列表中加入或移出，插件文件保留在本机
- **调整顺序** —— 加载顺序影响插件之间的覆盖关系，靠后的插件后加载
- **卸载** —— 真正从当前配置中移除插件。仅对 Profile 依赖开放；DSH 内置的核心组合层没有卸载入口

> 变更在**下次启动 DSH 时生效**。

### 资源市场

从 GitHub 合并检索带 `dsh-plugin` 或 `dsh-skill` Topic 的仓库，显示 Star 数、主语言、更新时间和描述。点击检测后，启动器会同时验证 Plugin 与 Skill 结构，并按识别标签调用对应安装器。

同一仓库可以同时提供 Plugin 和 Skill。此时列表显示 `Plugin + Skill`，安装按钮会打开组件选择窗口，由用户分别安装或更新。

搜索使用 GitHub 匿名 API，有速率限制；额度用尽时启动器会明确提示，稍后重试即可。

### 运行与日志

查看 DSH 运行状态、PID、启动时间和服务地址，以及实时日志流。日志分 `runtime`（DSH 本体）和 `plugin`（插件操作）两个通道，分 `info` / `error` / `success` 三个级别。

---

## DSH 本体检测与安装

启动器在资源市场会**特别识别**这个仓库：

```text
deepseek-ai/deepseek-harness
```

它不会被当作普通插件处理，而是走独立的本体安装流程。

### 检测顺序

启动时按以下顺序查找已安装的 DSH：

1. 启动器管理的运行目录（`%APPDATA%\dsh-launcher\dsh-runtime`）
2. 当前配置的启动命令
3. 系统 `PATH`
4. `%APPDATA%\npm`（Windows npm 全局目录）
5. 系统 Node.js 安装目录

> [!TIP]
> 检测结果必须**同时**包含官方 `@deepseek-ai/dsh` 包清单**和** `dsh` 可执行文件，才会被认定为有效安装 —— 这样可以避免把同名程序误认成 DSH。

### 安装行为

| 情况 | 行为 |
| --- | --- |
| 检测到系统安装 | 直接使用，不重复安装 |
| 未检测到 | 首页主按钮变为「下载安装 DSH」，引导首次部署 |
| 执行安装 | 通过 npm 将 `@deepseek-ai/dsh@latest` 装入启动器本地运行目录，并自动切换启动命令为本地可执行文件 |

安装完成后，首页按钮从「下载安装 DSH」自动切换为「启动 DSH」。

---

## Node.js 便携运行时

当系统中找不到 Node.js 时，启动器会自动准备一份便携运行时：

| 环节 | 说明 |
| --- | --- |
| **来源** | Node.js 官网 `https://nodejs.org/dist/`，当前锁定 `v24.19.0` |
| **架构** | 自动匹配 `win-x64` 或 `win-arm64` |
| **校验** | 下载官方 `SHASUMS256.txt`，逐字节 SHA-256 比对；校验失败自动重下一次，仍失败则中止并报错 |
| **续传** | 使用 HTTP `Range` 请求，网络中断后可从断点继续 |
| **解压** | 调用 Windows 自带 `tar.exe` 解压到临时目录，校验完整性后原子重命名到最终位置 |
| **位置** | `%APPDATA%\dsh-launcher\node-runtime\` |

> [!NOTE]
> 便携运行时的自动准备**仅支持 Windows**。若系统已安装 Node.js，启动器会直接复用，不会重复下载。

---

## 数据与配置

启动器**直接使用 DSH 官方 Profile 结构**，不引入任何不兼容的私有插件配置格式。

### 文件位置

| 内容 | 路径 |
| --- | --- |
| 启动器设置 | `%APPDATA%\dsh-launcher\settings.json` |
| 本地 DSH 运行目录 | `%APPDATA%\dsh-launcher\dsh-runtime\` |
| Node.js 便携运行时 | `%APPDATA%\dsh-launcher\node-runtime\` |
| GitHub 登录会话（加密） | `%APPDATA%\dsh-launcher\github-auth.bin` |
| DSH 凭据 | `$DSH_HOME\.credentials.yaml` |
| DSH Profile 清单 | `$DSH_HOME\profiles\<profile>\package.json` |

> `%APPDATA%\dsh-launcher\` 对应 Electron 的 `app.getPath('userData')`，目录名取自 `package.json` 的 `name` 字段。

### 默认配置

| 项 | 默认值 |
| --- | --- |
| `DSH_HOME` | 环境变量 `DSH_HOME`，否则 `%USERPROFILE%\.dsh` |
| Profile 名称 | `web` |
| 工作目录 | 系统「文档」目录 |
| 启动命令 | `npx --yes @deepseek-ai/dsh web`（检测到本地安装后自动切换为 `dsh web`） |
| 启动后自动打开网页 | 开启 |

---

## 安全设计

| 措施 | 实现 |
| --- | --- |
| **渲染进程隔离** | `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` |
| **受控 IPC 面** | 渲染层只能通过 `contextBridge` 暴露的固定接口与主进程通信，无法直接访问 Node API |
| **凭据文件权限** | `.credentials.yaml` 以 `0600` 写入，目录 `0700`；先写临时文件再原子重命名，避免写坏原文件 |
| **GitHub 凭据加密** | GitHub Token / OAuth 会话通过 Electron `safeStorage` 调用系统凭据保护能力加密，渲染层无法读取明文 |
| **外链白名单** | `shell.openExternal` 只允许 `http:` / `https:` 协议 |
| **输入校验** | 包名、Profile 名、GitHub 仓库名在进入主进程逻辑前统一校验；目录参数必须是绝对路径 |
| **下载完整性** | Node.js 运行时下载后强制 SHA-256 校验，不匹配即丢弃 |

---

## 从源码运行

### 环境要求

浏览器 OAuth 登录需要给构建过程设置公开的 `DSH_LAUNCHER_GITHUB_CLIENT_ID`。对应 GitHub OAuth App / GitHub App 必须启用 Device Flow；未配置时仍可在界面使用 Fine-grained Token 登录。Client ID 不是密钥，Release 工作流从同名 GitHub Actions Repository Variable 注入。

- **Node.js ≥ 20**
- Windows（打包便携版需要；开发调试可跨平台，但 Node 便携运行时相关功能仅 Windows 生效）

### 开发

```powershell
npm install
npm run dev
```

Windows 上也可以直接双击 `START-DSH-LAUNCHER.cmd`，脚本会在缺少依赖时自动执行 `npm install` 再启动开发服务器。

### 命令一览

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器 + Electron 主进程（热更新） |
| `npm test` | 运行 Vitest 测试套件 |
| `npm run build` | TypeScript 类型检查（`tsc --noEmit`）+ Vite 生产构建 |
| `npm run preview` | 预览构建产物 |
| `npm run package:win` | 构建并用 electron-builder 打包 Windows 便携版 |

打包产物输出到 `release/`，命名为 `DSH-Launcher-<version>-portable.exe`。

---

## 项目结构

```text
dsh-melody-launcher/
├── electron/                 # Electron 主进程
│   ├── main.ts               # 应用入口、窗口管理、IPC 注册
│   ├── preload.ts            # contextBridge 安全桥接层
│   ├── dsh-install.ts        # DSH 本体检测与安装
│   ├── node-runtime.ts       # Node.js 便携运行时下载与校验
│   ├── profile.ts            # DSH Profile 读写、插件启停与排序
│   ├── plugin-install.ts     # 插件安装辅助（构建脚本授权）
│   ├── process.ts            # 子进程封装与 PATH 处理
│   └── credentials.ts        # DeepSeek API Key 凭据管理
├── src/                      # React 渲染进程
│   ├── App.tsx               # 主界面
│   ├── main.tsx              # 渲染入口
│   ├── types.ts              # 主进程 / 渲染进程共享类型契约
│   ├── demo-api.ts           # 浏览器环境下的模拟 API
│   └── styles.css            # 样式
├── tests/                    # Vitest 测试
├── public/                   # 静态资源（图标、背景图）
└── build/                    # 打包资源（icon.ico）
```

`src/types.ts` 中的 `LauncherApi` 接口是主进程与渲染进程之间**唯一的契约**，`preload.ts` 负责实现，两侧共享同一份类型定义。

---

## 开发路线图

- [x] 小型无边框桌面启动界面
- [x] DeepSeek API Key 配置
- [x] 插件搜索、下载进度与安装状态
- [x] 插件结构检测、多组件选择和本地安装识别
- [x] Plugin / Skill 统一资源市场、规范检测、安装和更新
- [x] 插件启停、排序与卸载
- [x] DSH 本体识别与本地安装
- [x] 系统 DSH 检测与首次部署引导
- [x] 无系统 Node.js 环境下自动准备便携运行时
- [x] 自选 DSH 本体安装目录
- [x] DSH 启动、停止与日志查看
- [x] **插件整合包创建与导入**
- [ ] 整合包版本管理与分享

---

## 常见问题

<details>
<summary><b>Windows 提示「不受信任的应用」怎么办？</b></summary>

便携版未使用商业代码签名证书，SmartScreen 会拦截未知发布者的程序。确认文件来自本仓库 [Releases](https://github.com/rirko/dsh-melody-launcher/releases) 页面后，点击「更多信息 → 仍要运行」即可。

</details>

<details>
<summary><b>提示「本地端口已被其他进程占用」</b></summary>

说明有旧的 DSH 服务还在运行。关闭它，或在启动配置的启动参数中指定其他端口。

</details>

<details>
<summary><b>提示「GitHub 请求额度暂时用尽」</b></summary>

插件搜索使用 GitHub 匿名 API，每小时有速率限制。等待一段时间后重试即可。

</details>

<details>
<summary><b>停用插件后文件还在硬盘上，正常吗？</b></summary>

正常。停用只是把插件移出 Profile 的有序加载列表，本地依赖会保留，方便随时重新启用。只有执行**卸载**操作才会真正移除文件。

</details>

<details>
<summary><b>已经手动装过 DSH，启动器会重复安装吗？</b></summary>

不会。启动器会在运行目录、启动配置、`PATH`、`%APPDATA%\npm` 和系统 Node.js 目录中检测已有安装，检测到就直接使用。

</details>

<details>
<summary><b>能在 macOS 或 Linux 上用吗？</b></summary>

目前只提供 Windows 便携版。源码在其他平台可以运行开发服务器，但 Node.js 便携运行时的自动准备逻辑仅实现了 Windows 分支。

</details>

---

## 参与贡献

欢迎提交 Issue 和 Pull Request。

- **报告问题 / 提出建议** —— [Issues](https://github.com/rirko/dsh-melody-launcher/issues)
- **一起开发** —— QQ：**1250104511**

提交 PR 前请确保：

```powershell
npm test        # 测试通过
npm run build   # 类型检查与构建通过
```

---

## 许可证

> [!WARNING]
> 本仓库目前**尚未声明开源许可证**。在补充 `LICENSE` 文件之前，依据版权法默认保留所有权利 —— 这意味着其他人在法律上没有获得复制、修改或分发本项目的授权。如果希望本项目被自由使用和贡献，建议尽快添加一个开源许可证（例如 MIT 或 Apache-2.0）。

---

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —— 本启动器服务的对象
- 界面交互参考《我的世界》**忘却的旋律启动器**

<div align="center">
<br />

如果这个项目对你有帮助，欢迎点一个 ⭐

</div>
