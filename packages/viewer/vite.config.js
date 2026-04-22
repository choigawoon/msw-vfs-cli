import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
// Tauri dev server config:
// - fixed port, strict — Rust side reads from tauri.conf.json "devUrl"
// - clearScreen: false so tauri logs survive between HMR refreshes
var host = process.env.TAURI_DEV_HOST;
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { "@": path.resolve(__dirname, "./src") },
    },
    clearScreen: false,
    server: {
        port: 1420,
        strictPort: true,
        host: host !== null && host !== void 0 ? host : false,
        hmr: host
            ? { protocol: "ws", host: host, port: 1421 }
            : undefined,
        watch: { ignored: ["**/src-tauri/**"] },
    },
    envPrefix: ["VITE_", "TAURI_ENV_*"],
});
