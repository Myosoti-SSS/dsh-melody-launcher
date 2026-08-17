<div align="center">

<img src="public/launcher-icon.png" alt="DSH Melody Launcher" width="128" />

# DSH Melody Launcher

**A Windows desktop launcher and plugin manager for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)**

Download one executable and go: it manages DSH itself, plugins, your API key, and runtime configuration — no Node.js required up front.

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

[简体中文](README.md) · **English**

<br />

<img src="public/launcher-background.png" alt="DSH Melody Launcher" width="820" />

</div>

---

## Table of Contents

- [What is this](#what-is-this)
- [Features](#features)
- [Quick Start](#quick-start)
- [User Guide](#user-guide)
- [DSH Detection and Installation](#dsh-detection-and-installation)
- [Portable Node.js Runtime](#portable-nodejs-runtime)
- [Data and Configuration](#data-and-configuration)
- [Security Design](#security-design)
- [Running from Source](#running-from-source)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

---

## What is this

**DSH Melody Launcher** is a Windows desktop application that pulls the download, deployment, plugin management, and startup of DeepSeek Harness (DSH) into a single GUI. Its interaction model is inspired by the Minecraft **HMCL / Melody-style launchers**: before anything actually starts, you settle runtime configuration, API key, plugin toggles, and load order in one place.

The problems it removes:

| What you used to do | With the launcher |
| --- | --- |
| Install Node.js → install npm → `npx @deepseek-ai/dsh` | Download one exe, click "Install DSH" |
| Hand-edit `.credentials.yaml` to add your API key | Type it in the UI; written automatically with `0600` permissions |
| Search GitHub for plugins, type `dsh plugin add` | Built-in search over the `dsh-plugin` topic, one-click install |
| Edit the profile's `package.json` to change load order | Reorder a list; the official profile is updated directly |
| Open a terminal, remember commands, watch output | One button to launch, live log panel |

> [!NOTE]
> **Modpack support is under active development.** A future release will let you save, import, and share a set of plugins plus configuration as a reusable bundle. Contributors welcome — QQ: **1250104511**

---

## Features

### Deployment and Launch

- **Zero-prerequisite first run** — when no local DSH is detected, the home button switches to "Install DSH" and handles first-time deployment
- **Automatic Node.js provisioning** — works even without Node.js installed: downloads the official portable runtime, verifies it with SHA-256, and supports resuming interrupted downloads
- **Automatic pnpm provisioning** — installs a launcher-managed pnpm on the first plugin operation, with no global command required, and shares it across regular installs, modpacks, and AI-assisted installation
- **Multi-path DSH detection** — checks the launcher's runtime directory, the configured launch command, `PATH`, `%APPDATA%\npm`, and the system Node.js directory
- **Process lifecycle management** — start, stop, and stream live logs (stdout/stderr, leveled); stopping or exiting also cleans up companion processes launched by the app
- **Auto-open the web UI** — detects the local service URL from the log stream and opens it in your browser (optional)

### Unified Resource Market and Plugin Management

- **Unified discovery** — searches [`dsh-plugin`](https://github.com/topics/dsh-plugin), [`dsh-skill`](https://github.com/topics/dsh-skill), and `dsh-app`, then combines them in one catalog
- **Content-based classification** — topics are candidate sources only; repository inspection recognizes plugins, skills, application add-ons, agent presets, hybrid resources, DSH core, and invalid repositories
- **Type-routed installation** — plugins go to a DSH profile, skills and presets use their dedicated directories, and application add-ons get isolated runtimes with explicit user selection
- **Application add-on management** — supports runtime replacement, after-runtime companion, and standalone launch modes, with synchronized toggles for linked plugins
- **Meta-repository support** — expands Git submodule suites and installs components from pinned revisions or GitHub Release assets
- **Strict Skill validation** — validates directory `SKILL.md` bundles and flat Markdown skills, including required YAML frontmatter
- **Staged install progress** — `preparing → resolving → downloading → configuring → complete`, with percentage and live status text
- **Load order control** — reads and writes the official DSH profile directly to toggle plugins and reorder bundles
- **Disable ≠ uninstall** — disabling only removes a plugin from the ordered load list; local dependencies stay on disk and can be re-enabled at any time. Only an explicit uninstall deletes files
- **Core bundle protection** — the three core bundles (`@deepseek-ai/dsh-base`, `dsh-web-app`, `dsh-headless`) cannot be disabled — the main process rejects it — and the UI offers no uninstall action for them
- **Automatic build-script approval** — on pnpm's `ERR_PNPM_IGNORED_BUILDS`, approves build scripts scoped to the repository being installed and retries automatically

### Interface and Configuration

- **Dual-size window** — frameless design that switches between launcher mode (900×560) and manager mode (1380×860)
- **GitHub account login** — supports OAuth Device Flow and fine-grained tokens, encrypts credentials with Electron safe storage, and authenticates catalog, inspection, download, and update requests centrally
- **API management** — configure the DeepSeek API key or add custom OpenAI Completions, OpenAI Responses, and Anthropic Messages-compatible providers
- **Launcher self-update** — checks GitHub Releases on startup and can download and apply a new portable build from the app
- **Full runtime configuration** — `DSH_HOME`, profile name, working directory, launch executable and arguments are all editable in the UI
- **Portable** — the launcher itself needs no installation; a single exe

---

## Quick Start

### 1. Download

Grab the latest `DSH-Launcher-*-portable.exe` from [**Releases**](https://github.com/rirko/dsh-melody-launcher/releases/latest).

> [!IMPORTANT]
> The portable build is **not signed with a commercial code-signing certificate**. Windows SmartScreen may warn about an unknown publisher on first run. After confirming the file came from this repository's Releases page, choose "More info → Run anyway".

### 2. First-time deployment

Open the launcher. If no local DSH is found, the home button reads **"Install DSH"** — click it to complete first-time deployment.

The whole flow requires **no pre-installed DSH, Node.js, npm, or npx** — the launcher provisions whatever is missing. Keep your network connection up; if a download is interrupted, clicking again resumes it.

### 3. Configure your API key

Enter your DeepSeek API key on the launch page. It is written to the official DSH credentials file at `$DSH_HOME/.credentials.yaml`.

### 4. Install Plugins or Skills (optional)

Open **Resource Market**, inspect a repository to identify its real type, and install the selected Plugin or Skill. Installed Plugins remain configurable under **Load Order**.

### 5. Launch

Return to the launch page and click **"Start DSH"**. Once the service is ready, the Harness web UI opens automatically.

---

## User Guide

The launcher has three main views:

### Load Order

Lists every bundle in the current profile. For each plugin you can:

- **Enable / disable** — the toggle adds or removes the plugin from the ordered load list; files stay on disk
- **Reorder** — load order determines override precedence; later entries load later
- **Uninstall** — actually removes the plugin from the current profile. Available for profile dependencies only; DSH's built-in core bundles have no uninstall action

> Changes take effect **the next time DSH starts**.

### Discover

Searches GitHub for repositories tagged with the `dsh-plugin` topic, showing stars, primary language, last update, and description. Click to install.

Search uses the anonymous GitHub API, which is rate limited. When the quota runs out the launcher says so explicitly — just retry later.

### Runtime and Logs

Shows DSH status, PID, start time, and service URL, plus a live log stream. Logs are split into `runtime` (DSH itself) and `plugin` (plugin operations) channels, at `info` / `error` / `success` levels.

---

## DSH Detection and Installation

On the discovery page, the launcher **specifically recognizes** this repository:

```text
deepseek-ai/deepseek-harness
```

It is not treated as an ordinary plugin; it goes through a dedicated installation path instead.

### Detection order

At startup, the launcher looks for an existing DSH installation in this order:

1. The launcher-managed runtime directory (`%APPDATA%\dsh-launcher\dsh-runtime`)
2. The currently configured launch command
3. The system `PATH`
4. `%APPDATA%\npm` (the Windows npm global directory)
5. The system Node.js installation directory

> [!TIP]
> A candidate only counts as a valid installation if it has **both** the official `@deepseek-ai/dsh` package manifest **and** a `dsh` executable — this prevents an unrelated program with the same name from being mistaken for DSH.

### Installation behaviour

| Situation | Behaviour |
| --- | --- |
| System installation detected | Used directly; nothing is reinstalled |
| Nothing detected | The home button becomes "Install DSH" and guides first-time deployment |
| Installation runs | `@deepseek-ai/dsh@latest` is installed via npm into the launcher's local runtime directory, and the launch command is switched to the local executable |

Once installation finishes, the home button changes from "Install DSH" to "Start DSH".

---

## Portable Node.js Runtime

When no Node.js is found on the system, the launcher provisions a portable runtime:

| Step | Details |
| --- | --- |
| **Source** | The official `https://nodejs.org/dist/`, currently pinned to `v24.19.0` |
| **Architecture** | Automatically matches `win-x64` or `win-arm64` |
| **Verification** | Downloads the official `SHASUMS256.txt` and compares SHA-256 byte for byte; on mismatch it re-downloads once, then aborts with an error |
| **Resume** | Uses HTTP `Range` requests, so an interrupted download continues where it stopped |
| **Extraction** | Extracts with the built-in Windows `tar.exe` into a staging directory, verifies completeness, then atomically renames into place |
| **Location** | `%APPDATA%\dsh-launcher\node-runtime\` |

> [!NOTE]
> Automatic runtime provisioning is **Windows only**. If Node.js is already installed, the launcher reuses it rather than downloading anything.

---

## Data and Configuration

The launcher **uses the official DSH profile structure directly**. It does not introduce a proprietary, incompatible plugin configuration format.

### File locations

| Content | Path |
| --- | --- |
| Launcher settings | `%APPDATA%\dsh-launcher\settings.json` |
| Local DSH runtime | `%APPDATA%\dsh-launcher\dsh-runtime\` |
| Portable Node.js runtime | `%APPDATA%\dsh-launcher\node-runtime\` |
| GitHub session (encrypted) | `%APPDATA%\dsh-launcher\github-auth.bin` |
| DSH credentials | `$DSH_HOME\.credentials.yaml` |
| DSH profile manifest | `$DSH_HOME\profiles\<profile>\package.json` |

> `%APPDATA%\dsh-launcher\` is Electron's `app.getPath('userData')`; the directory name comes from the `name` field in `package.json`.

### Defaults

| Setting | Default |
| --- | --- |
| `DSH_HOME` | The `DSH_HOME` environment variable, otherwise `%USERPROFILE%\.dsh` |
| Profile name | `web` |
| Working directory | The system Documents folder |
| Launch command | `npx --yes @deepseek-ai/dsh web` (switches to `dsh web` once a local installation is detected) |
| Open web UI after launch | Enabled |

---

## Security Design

| Measure | Implementation |
| --- | --- |
| **Renderer isolation** | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| **Constrained IPC surface** | The renderer talks to the main process only through a fixed `contextBridge` interface; it has no direct Node API access |
| **Credential file permissions** | `.credentials.yaml` is written with mode `0600` inside a `0700` directory, via a temp file plus atomic rename so the original is never corrupted |
| **GitHub credential encryption** | GitHub tokens and OAuth sessions are encrypted through Electron `safeStorage`; the renderer never receives plaintext credentials |
| **External-link allowlist** | `shell.openExternal` accepts only `http:` and `https:` |
| **Input validation** | Package names, profile names, and GitHub repository names are validated before reaching main-process logic; directory arguments must be absolute paths |
| **Download integrity** | The Node.js runtime is SHA-256 verified after download and discarded on mismatch |

---

## Running from Source

Browser-based OAuth login requires the public `DSH_LAUNCHER_GITHUB_CLIENT_ID` build variable. The matching GitHub OAuth App or GitHub App must have Device Flow enabled. When it is absent, fine-grained token login remains available. Release builds read this value from the repository variable with the same name.

### Requirements

- **Node.js ≥ 20**
- Windows (required to package the portable build; the dev server runs cross-platform, but portable Node.js provisioning is Windows-only)

### Development

```powershell
npm install
npm run dev
```

On Windows you can also double-click `START-DSH-LAUNCHER.cmd`, which runs `npm install` if dependencies are missing and then starts the dev server.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server and Electron main process with hot reload |
| `npm test` | Run the Vitest suite |
| `npm run build` | TypeScript type check (`tsc --noEmit`) plus Vite production build |
| `npm run preview` | Preview the production build |
| `npm run package:win` | Build and package the Windows portable app with electron-builder |

Build artifacts land in `release/` as `DSH-Launcher-<version>-portable.exe`.

---

## Project Structure

```text
dsh-melody-launcher/
├── electron/                 # Electron main process
│   ├── main.ts               # App entry, window management, IPC registration
│   ├── preload.ts            # contextBridge security layer
│   ├── dsh-install.ts        # DSH detection and installation
│   ├── node-runtime.ts       # Portable Node.js download and verification
│   ├── profile.ts            # DSH profile I/O, plugin toggling and ordering
│   ├── plugin-install.ts     # Plugin install helpers (build-script approval)
│   ├── process.ts            # Child-process wrapper and PATH handling
│   └── credentials.ts        # DeepSeek API key credential management
├── src/                      # React renderer process
│   ├── App.tsx               # Main UI
│   ├── main.tsx              # Renderer entry
│   ├── types.ts              # Shared main/renderer type contract
│   ├── demo-api.ts           # Mock API for browser-only development
│   └── styles.css            # Styles
├── tests/                    # Vitest tests
├── public/                   # Static assets (icon, background)
└── build/                    # Packaging assets (icon.ico)
```

The `LauncherApi` interface in `src/types.ts` is the **single contract** between the main and renderer processes. `preload.ts` implements it, and both sides share the same type definition.

---

## Roadmap

- [x] Compact frameless desktop launcher UI
- [x] DeepSeek API key configuration
- [x] Plugin search, download progress, and install status
- [x] Plugin enable/disable, reorder, and uninstall
- [x] DSH recognition and local installation
- [x] System DSH detection and first-time deployment flow
- [x] Automatic portable runtime provisioning without system Node.js
- [x] DSH start, stop, and log viewing
- [ ] **Modpack creation and import** (in progress)
- [ ] Modpack version management and sharing

---

## FAQ

<details>
<summary><b>Windows says the app is untrusted. What do I do?</b></summary>

The portable build has no commercial code-signing certificate, so SmartScreen blocks unknown publishers. After confirming the file came from this repository's [Releases](https://github.com/rirko/dsh-melody-launcher/releases) page, click "More info → Run anyway".

</details>

<details>
<summary><b>I get "the local port is already in use"</b></summary>

An older DSH service is still running. Close it, or specify a different port in the launch arguments.

</details>

<details>
<summary><b>I get "GitHub rate limit exceeded"</b></summary>

Plugin search uses the anonymous GitHub API, which has an hourly rate limit. Wait a while and try again.

</details>

<details>
<summary><b>After disabling a plugin its files are still on disk. Is that normal?</b></summary>

Yes. Disabling only removes the plugin from the profile's ordered load list; local dependencies are kept so you can re-enable it instantly. Only an explicit **uninstall** deletes files.

</details>

<details>
<summary><b>I already installed DSH manually. Will the launcher install it again?</b></summary>

No. The launcher checks its runtime directory, the launch configuration, `PATH`, `%APPDATA%\npm`, and the system Node.js directory for an existing installation, and uses it if found.

</details>

<details>
<summary><b>Does it work on macOS or Linux?</b></summary>

Only a Windows portable build is published today. The source runs a dev server on other platforms, but automatic portable Node.js provisioning is implemented for Windows only.

</details>

---

## Contributing

Issues and pull requests are welcome.

- **Report a bug / suggest a feature** — [Issues](https://github.com/rirko/dsh-melody-launcher/issues)
- **Build it with us** — QQ: **1250104511**

Before opening a PR, please make sure:

```powershell
npm test        # tests pass
npm run build   # type check and build pass
```

---

## License

> [!WARNING]
> This repository **does not currently declare an open-source license**. Until a `LICENSE` file is added, all rights are reserved by default under copyright law — meaning no one is legally granted permission to copy, modify, or distribute this project. If you want the project to be freely used and contributed to, adding a license (such as MIT or Apache-2.0) should be a priority.

---

## Acknowledgements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the project this launcher serves
- UI interaction inspired by Minecraft's **Melody launcher**

<div align="center">
<br />

If this project helps you, consider leaving a ⭐

</div>
