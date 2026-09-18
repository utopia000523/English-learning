import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发模式：前端 5173，接口代理到 5180；正式运行由 server 在 5173 同时提供页面和接口
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:5180' } },
});
