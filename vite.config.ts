import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(process.env.npm_package_version)
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'Vitarx',
      fileName: format => `vitarx.${format}.js`,
      formats: ['umd']
    }
  },
  esbuild: {
    // 不压缩标识符（如函数名）
    minifyIdentifiers: false
  }
})
