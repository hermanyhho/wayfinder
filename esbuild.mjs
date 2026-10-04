import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");
const shared = { bundle: true, sourcemap: !production, minify: production, logLevel: "info" };

const contexts = await Promise.all([
  esbuild.context({ ...shared, entryPoints: ["src/extension.ts"], outfile: "out/extension.js", platform: "node", format: "cjs", external: ["vscode"] }),
  esbuild.context({ ...shared, entryPoints: ["src/webview/main.ts"], outfile: "out/webview.js", platform: "browser", format: "iife" }),
  esbuild.context({ ...shared, entryPoints: ["src/webview/styles.css"], outfile: "out/webview.css" }),
]);

if (watch) {
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(contexts.map((context) => context.rebuild()));
  await Promise.all(contexts.map((context) => context.dispose()));
}
