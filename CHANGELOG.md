# 更新日志

本文件记录 DSH 旋律启动器（dsh-melody-launcher）的版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本语义遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [v0.3.6] - 2026-08-24

### 新增功能

- **Copilot 模型切换选择器**：输入框上方新增模型下拉选择器，枚举 DeepSeek 官方与全部已配置的自定义 API 模型；缺密钥或协议不兼容的选项置灰并标注。切换到某模型后立即持久化到当前会话（`provider|model`），下一条消息按新模型重启 agent 实例；面板每次打开时刷新候选列表。新增 `ai-sessions:set-model` IPC 通道，前端乐观更新、失败回滚并通过 Toast 提示。
- **自定义第三方 API 接入 Copilot**：ACP 运行时只注册了 `deepseek-official` 一个适配器（OpenAI 兼容 `/chat/completions`，支持 `DEEPSEEK_BASE_URL` 覆盖端点）。现在自定义 API 统一映射到该适配器：以用户填写的第三方端点作为 `DEEPSEEK_BASE_URL`、自定义密钥作为 `DEEPSEEK_API_KEY`、模型名直传实际模型标识注入子进程，绕开 `no adapter registered for provider "…"` 报错。模型解析优先级：`agent-default-model` 指定的自定义 provider → DeepSeek 官方 Key → 第一个带本地密钥、OpenAI 兼容协议的自定义 provider。

### Bug 修复

- **Copilot 打开时缩小窗口，启动项管理页排版错乱**：工作区宽度 = 窗口宽 − 侧栏 − Copilot 列，默认 1380 管理窗口打开 Copilot 后工作区仅剩约 742px，低于管理页两列布局下限（940px），页面横向溢出。修复：≤1250px 时 Copilot 从网格列改为悬浮覆盖（工作区恢复完整宽度）；≤1578px 且 Copilot 打开时提前应用管理页/插件列表/仓库行的中等宽度适配（单列布局、隐藏详情列）。
- **切换到 DSH Market 页时运行日志灵动岛自动弹出**：市场目录拉取与更新检查的合成进度曾经同时进入日志列表与 `installProgress` 状态，被当成安装活动触发自动弹出，并在同步期间短暂锁定 Profile/整合包切换。修复：真实子进程输出（`onRuntimeOutput`）才触发"新日志即活动"；目录同步/更新检查只写日志行，带插件名的安装/更新/卸载操作照旧进入安装活动路径。
- **Copilot 面板字号过小、不随窗口放大自适应**：对话正文、输入框、标签、工具消息、按钮统一接入 `clamp()` 动态字号（约 12px → 15.5px 随窗口宽度缩放）；Markdown 标题改用 em 相对单位跟随缩放；行高调整为 1.6 倍字号。
- **GitHub 账号对话框「API 额度」行排版突兀**：原为带边框背景的独立小盒，与上方「授权范围」裸标题行风格不统一。改为与之一致的分区结构：标题行（左标题/右数字）+ 剩余额度进度条（带无障碍标记），三区视觉节奏统一。
- **窗口聚焦切回时 GitHub 页总是「正在读取 GitHub」转圈**：聚焦 → 重新拉取登录状态（新对象）→ 内联 `onError` 新引用 → 加载 effect 被无谓重跑。修复：`onError` 改为稳定引用（`useCallback`）；GitHub 页已有数据时走静默刷新路径（列表原地保留、不显示 loading），仅首次加载显示转圈。
- **GitHub 空列表提示排版**：去掉「还没有找到基于 Melody Launcher 的提交。」左侧多余图标；补齐空态样式，左内边距 47px 与「最近提交」标题文字精确齐头。

### 测试

- 新增 `tests/copilot-api.test.ts`、`tests/copilot-sessions.test.ts` 共 21 项：自定义 API → `deepseek-official` 映射、`agent-default-model` 优先级、按 provider/model 解析、会话模型持久化/清空/格式校验、模型候选枚举。
- 全套 569 项测试通过（47 项 e2e 依赖真实环境按惯例跳过），`tsc --noEmit` 与 `vite build` 通过。

## [v0.3.5] - 2026-08-23

- **API 配置弹窗底部按钮被裁切**：矮窗口（启动器首屏 900×560）下弹窗限高未计入标签栏高度，底部按钮栏被 `overflow: hidden` 裁掉；改为纵向 flex 布局，仅表单区域滚动。
- **启动卡死在「正在读取 DSH 配置」**：凭据文件为 `version/refs` 新格式时 `credentials:deepseek-status` IPC 失败导致启动 `Promise.all` 整体失败；凭据状态读取失败时降级为「未配置」并提示，不再阻塞启动。
- **管理界面顶栏「未启动」左侧半个小方形**：统计盒被压缩导致「打开配置目录」方形按钮被边框裁掉一半；统计/状态盒改为不可压缩。
- **「默认配置」图块样式统一**：350px 大圆角胶囊改为与相邻芯片一致（260px、32px 高、6px 圆角、去阴影），下拉框同步收紧。
- **顶栏窄窗口响应式**：新增 1320px 断点，切换器与右侧按钮随窗口宽度同步渐进收缩，1380→860px 区间不再挤爆。
- **预设残留删不掉、刷新按钮不生效**：新增预设卸载全链路（`presets:uninstall` IPC + 预设行二次确认删除按钮 + 路径/名称安全校验）；「刷新」改为同步重读 Skill、应用加载项与预设。
- **资源市场仓库行四列缩放**：语言/活跃度列固定宽、内容靠左，操作按钮左对齐紧贴活跃度列，表头与各行严格对齐，窗口缩放不再错位。