import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        /** Suppress hundreds of Bootstrap 5 @import / color-function deprecations from node_modules */
        quietDeps: true,
        silenceDeprecations: ["import", "global-builtin", "color-functions", "if-function"],
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
