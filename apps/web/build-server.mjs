import { copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

await build({
  entryPoints: { server: "server.ts", "create-user": "scripts/create-user.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  tsconfig: "tsconfig.json",
  external: ["next", "next/*", "pg-native", "bufferutil", "utf-8-validate"],
  banner: {
    js: "import { createRequire as __understudyCreateRequire } from 'node:module'; const require = __understudyCreateRequire(import.meta.url);",
  },
  logLevel: "info",
});

await copyFile(createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm"), "dist/resvg.wasm");
