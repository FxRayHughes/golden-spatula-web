import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    // 本地开发：`pnpm server` 启动 Go 后端后，/api 转发过去
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
})
