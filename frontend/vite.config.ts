
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import pkg from "./package.json";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Default 8082 = porta oficial do backend SMARTPICK (alinha com prod e ./dev.sh).
  // Antes apontava para 8081 que é faixa dos módulos APU — causava proxy errado no dev.
  const target = env.VITE_API_TARGET || "http://localhost:8082";
  // Default 3082 = espelha o backend e evita colisão com FAROL (3087), APU01/02/03 (3000…3081)
  // e FBTAX_CLOUD (3086) quando rodando vários módulos dev simultaneamente.
  const devPort = Number(env.VITE_DEV_PORT) || 3082;

  console.log(`[Vite] Dev server porta ${devPort} → proxying /api para ${target}`);

  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    server: {
      host: "0.0.0.0",
      port: devPort,
      proxy: {
        "/api": {
          target: target,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    plugins: [
      react(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
