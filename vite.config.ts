import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const githubClientId = process.env.DSH_LAUNCHER_GITHUB_CLIENT_ID ?? env.DSH_LAUNCHER_GITHUB_CLIENT_ID ?? ''
  return {
    define: {
      // Client ID 不是密钥；发布构建通过仓库 Variable 注入后写入主进程包。
      'process.env.DSH_LAUNCHER_GITHUB_CLIENT_ID': JSON.stringify(githubClientId),
    },
    plugins: [
      react(),
      electron({
        main: {
          entry: 'electron/main.ts',
          vite: {
            define: {
              'process.env.DSH_LAUNCHER_GITHUB_CLIENT_ID': JSON.stringify(githubClientId),
            },
          },
        },
        preload: {
          input: 'electron/preload.ts',
        },
      }),
    ],
    server: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: false,
    },
    build: {
      sourcemap: true,
    },
  }
})
