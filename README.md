# dsh-旋律启动器

![dsh-旋律启动器](public/launcher-background.png)

一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Windows 桌面下载/启动器和插件管理器，提供本体和插件下载/管理，整合包安装功能。界面参考我的世界忘却的旋律启动器的使用方式，在启动 DSH 前集中管理运行配置、DeepSeek API Key、插件状态和加载顺序。

> 开发状态：整合包功能正在开发中。后续将支持将一组插件与配置保存、导入和分享为可复用的整合包。欢迎加入一起开发：QQ:1250104511

## 功能

- 小型无边框启动窗口，支持拖动、启动和停止 DSH，并可直接打开 Harness 网页
- 在软件内配置或清除 DeepSeek API Key
- 从 GitHub [`dsh-plugin`](https://github.com/topics/dsh-plugin) Topic 搜索插件
- 从 GitHub [`dsh-skill`](https://github.com/topics/dsh-skill) Topic 搜索并安装 Skills
- 安装前检查插件清单或 Skill frontmatter，过滤仅添加 Topic、但并非有效组件的仓库
- 支持一键检测当前插件或 Skill 候选列表，并区分单组件、多组件和无效仓库
- 显示插件或 DSH 本体的下载状态、安装阶段和进度
- 自动检测启动器安装目录、当前启动配置、PATH 和 Windows npm 全局目录中的官方 DSH
- 未检测到本地 DSH 时，首页主按钮自动切换为“下载安装 DSH”完成首次部署
- 未检测到 Node.js 时自动下载、校验并使用官方便携运行时，支持中断后续传
- 当插件列表中出现 `deepseek-ai/deepseek-harness` 时，将其识别为 DSH 本体并安装到启动器本地运行目录
- 读取 DSH 官方 Profile，启用、停用和调整插件加载顺序
- 卸载第三方插件，同时保护 DSH Web Profile 所需的核心 Bundle
- 自选 DSH 本体安装目录，并与保存 Profile、插件和 Skills 的 `DSH_HOME` 分开管理
- 配置 `DSH_HOME`、Profile、工作目录、启动命令和启动后自动打开网页
- 查看 DSH 启动状态、进程信息和实时日志
- Windows 便携版，无需安装启动器本身

## 使用方法

1. 从 [Releases](../../releases) 下载最新的 `DSH-Launcher-*-portable.exe`。
2. 打开启动器；如果没有检测到本地 DSH，点击首页“下载安装 DSH”完成首次部署。
3. 在启动页配置 DeepSeek API Key，然后进入“管理”页面安装第三方插件。
4. 在“插件加载顺序”中调整启用状态和加载顺序。
5. 返回启动页并点击“启动 DSH”。服务就绪后可直接打开 Harness 网页。

使用 Release 便携版时不要求预先安装 DSH、Node.js、npm 或 npx。首次部署 DSH 时，启动器会从 Node.js 官网下载经过 SHA-256 校验的便携运行时；请保持网络连接，下载中断后可继续。

Windows 便携版目前未使用商业代码签名证书。首次运行时，Windows 可能显示来源提示，请确认文件来自本仓库 Release 后继续。

## DSH 本体安装

启动器会在插件发现页特别识别：

```text
deepseek-ai/deepseek-harness
```

启动时会先检查启动器管理的运行目录、当前启动命令、PATH、`%APPDATA%\npm` 和系统 Node.js 目录。检测结果必须同时包含官方 `@deepseek-ai/dsh` 包清单和 `dsh` 可执行文件，避免把同名程序误认为 DSH。检测到系统安装后会直接使用它；未检测到时，首页主按钮会进入首次部署流程。

安装该项目时不会把它当作普通插件处理，而是通过 npm 安装最新的 `@deepseek-ai/dsh` 到设置中选择的本体安装目录，并自动切换启动命令。本体安装目录不能是磁盘根目录或 `DSH_HOME`，也不会覆盖已有的其他 Node.js 项目。安装完成后首页按钮会从“下载安装 DSH”切换为“启动 DSH”。

## Skill Hub

Skill Hub 会读取 GitHub `dsh-skill` Topic，但不会直接把 Topic 当作有效证明。安装前会下载仓库快照并检查目录型 `<name>/SKILL.md` 或单文件 `<name>.md`，要求 YAML frontmatter 至少包含 kebab-case 的 `name` 和非空 `description`。多 Skill 仓库可以选择组件，安装结果写入：

```text
$DSH_HOME/skills
```

本地同名 Skill 会显示为已安装，并可从原仓库更新。

## 从源码运行

环境要求：Node.js 20 或更高版本。

```powershell
npm install
npm run dev
```

也可以在 Windows 上双击 `START-DSH-LAUNCHER.cmd`。

## 测试与构建

```powershell
npm test
npm run build
npm run package:win
```

Windows 便携版输出到 `release/`。

## 开发计划

- [x] 小型桌面启动界面
- [x] DeepSeek API Key 配置
- [x] 插件搜索、下载进度和安装状态
- [x] 插件结构检测、多组件选择和本地安装识别
- [x] Skill Hub、规范检测、安装和更新
- [x] 插件启停、排序和卸载
- [x] DSH 本体识别与本地安装
- [x] 系统 DSH 检测与首次部署引导
- [x] 无系统 Node.js 环境下自动准备便携运行时
- [x] 自选 DSH 本体安装目录
- [x] DSH 启动、停止和日志查看
- [ ] 插件整合包创建与导入（开发中）
- [ ] 整合包版本管理与分享

## 数据与配置

启动器直接使用 DSH 官方 Profile 结构，不建立不兼容的插件配置格式。默认配置位于：

```text
$DSH_HOME/profiles/<profile>/package.json
```

第三方 Bundle 的停用只会将其移出有序加载列表，不会删除本地依赖；只有执行卸载操作时才会移除插件。
