import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const proxyTarget = env.VITE_SECUREKIT_DEV_PROXY_TARGET?.trim() || "http://localhost:3001";

  return {
    plugins: [react()],
    envDir: __dirname,
    css: {
      postcss: {
        plugins: [],
      },
    },
    server: {
      proxy: {
        "/api/securekit": {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (requestPath) => requestPath.replace(/^\/api\/securekit/, ""),
        },
      },
    },
  };
});
