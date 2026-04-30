import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/** Evita CORS: o browser fala com o Vite; o Vite encaminha para LM Studio na porta 1234. */
const lmStudioProxy = {
  target: "http://localhost:1234",
  changeOrigin: true,
  rewrite: (p: string) => p.replace(/^\/lmstudio/, ""),
} as const;

const devProxy = {
  "/api": "http://localhost:5000",
  "/output": "http://localhost:5000",
  "/lmstudio": lmStudioProxy,
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 3000,
    proxy: { ...devProxy },
  },
  preview: {
    port: 3000,
    proxy: { ...devProxy },
  },
});
