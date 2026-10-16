import { defineConfig } from "vite";

// BASE_PATH lets the same build run at a domain root ("/") or under GitHub Pages ("/fluke/").
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 900,
  },
});
