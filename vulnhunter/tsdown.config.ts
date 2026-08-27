import { defineConfig } from 'tsdown'

export default defineConfig({
  // 命名入口：产物拍平为 dist/index.js 与 dist/mcp-sse-bridge.js，与 exports 对齐。
  entry: { index: 'src/index.ts', 'mcp-sse-bridge': 'plugin/mcp-sse-bridge.ts' },
  outDir: 'dist',
  format: 'esm',
  platform: 'node',
  // 运行时依赖全部外置：宿主与本包各自解析，绝不打包进产物。
  external: [/^@deepseek-ai\//, /^@modelcontextprotocol\//, /^zod$/, /^yaml$/],
  dts: false,
  clean: true,
})
