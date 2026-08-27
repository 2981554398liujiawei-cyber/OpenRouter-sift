import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "ui",
  base: "/ui/",
  plugins: [react()],
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
  },
  test: {
    include: ["../test/**/*.{test,spec}.{ts,tsx}"],
  },
});
