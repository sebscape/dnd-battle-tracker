import { defineConfig } from "vite";

// Port 5174 so this can run beside dnd-monster-reference (5173), whose bridge
// allows http://localhost:5174 during development.
export default defineConfig({ base: "/", server: { port: 5174, strictPort: true } });
