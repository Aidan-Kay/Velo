import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { builtinModules } from "module";
import { resolve } from "path";

/** Copy SumatraPDF exe to out/main/ so pdf-to-printer can find it at runtime. */
function copySumatraPdf(): import("vite").Plugin {
  return {
    name: "copy-sumatra-pdf",
    writeBundle() {
      const src = resolve("node_modules/pdf-to-printer/dist/SumatraPDF-3.4.6-32.exe");
      const destDir = resolve("out/main");
      const dest = resolve(destDir, "SumatraPDF-3.4.6-32.exe");
      if (existsSync(src) && !existsSync(dest)) {
        mkdirSync(destDir, { recursive: true });
        copyFileSync(src, dest);
      }
    },
  };
}

export default defineConfig({
  main: {
    plugins: [copySumatraPdf()],
    build: {
      rollupOptions: {
        external: ["electron", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
        input: {
          main: resolve("src/main/main.ts"),
          "label-worker": resolve("src/main/label-worker.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  preload: {},
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
      },
    },
    build: {
      rollupOptions: {
        input: resolve("src/renderer/index.html"),
        output: {
          manualChunks(id: string) {
            if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/") || id.includes("node_modules/react-is")) {
              return "vendor-react";
            }
            if (id.includes("node_modules/radix-ui") || id.includes("node_modules/@radix-ui")) {
              return "vendor-radix";
            }
            if (id.includes("node_modules/date-fns")) {
              return "vendor-datefns";
            }
            if (id.includes("node_modules/@tanstack/react-virtual")) {
              return "vendor-virtual";
            }
          },
        },
      },
    },
  },
});
