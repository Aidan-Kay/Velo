import esbuild from "esbuild";

const target = process.argv[2]; // "main" | "preload" | "renderer"

const configs = {
  main: {
    entryPoints: ["src/main/main.ts"],
    bundle: true,
    outfile: "dist/main.js",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron", "electron-log"],
    sourcemap: true,
  },
  preload: {
    entryPoints: ["src/preload/preload.ts"],
    bundle: true,
    outfile: "dist/preload.js",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron"],
    sourcemap: true,
  },
  renderer: {
    entryPoints: ["src/renderer/src/index.tsx"],
    bundle: true,
    outfile: "dist/renderer.js",
    platform: "browser",
    format: "iife",
    target: "chrome120",
    jsx: "automatic",
    jsxImportSource: "react",
    sourcemap: true,
    alias: {
      "@": "./src/renderer/src",
    },
    loader: {
      ".tsx": "tsx",
      ".ts": "ts",
      ".png": "dataurl",
      ".svg": "dataurl",
    },
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  },
};

if (target && configs[target]) {
  await esbuild.build(configs[target]);
  console.log(`[esbuild] ${target} build complete.`);
} else {
  // Build all
  await Promise.all(
    Object.entries(configs).map(async ([name, config]) => {
      await esbuild.build(config);
      console.log(`[esbuild] ${name} build complete.`);
    }),
  );
}
