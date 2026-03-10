import { Agent as HttpsAgent } from "node:https";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_MATRIX_PROXY_TARGET;
  const proxyHost = env.VITE_MATRIX_PROXY_HOST?.trim();
  const proxyAgent = proxyHost
    ? new HttpsAgent({
        rejectUnauthorized: false,
        servername: proxyHost,
      })
    : undefined;
  const proxyHeaders = proxyHost ? { host: proxyHost } : undefined;

  return {
    plugins: [react()],
    server: proxyTarget
      ? {
          proxy: {
            "/_matrix": {
              target: proxyTarget,
              changeOrigin: true,
              secure: false,
              agent: proxyAgent,
              headers: proxyHeaders,
            },
            "/_synapse": {
              target: proxyTarget,
              changeOrigin: true,
              secure: false,
              agent: proxyAgent,
              headers: proxyHeaders,
            },
          },
        }
      : undefined,
  };
});
