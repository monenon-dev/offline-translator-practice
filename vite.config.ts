import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Connect, type Plugin } from 'vite'

// crossOriginIsolated 상태여야 브라우저 WASM이 멀티스레드로 돈다 (단일 스레드 대비 번역 속도 차이가 큼).
// server.headers는 304 응답에 붙지 않아 캐시된 워커가 COEP 위반으로 차단되므로, 모든 응답에 직접 붙인다.
const setIsolationHeaders: Connect.NextHandleFunction = (_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
  next()
}

const crossOriginIsolation: Plugin = {
  name: 'cross-origin-isolation',
  configureServer: (server) => void server.middlewares.use(setIsolationHeaders),
  configurePreviewServer: (server) => void server.middlewares.use(setIsolationHeaders),
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [crossOriginIsolation, react(), tailwindcss()],
})
