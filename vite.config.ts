/**
 * Builds Boo Blocks to one self-contained file, dist/index.html: the script and styles inline, nothing loaded by URL
 * (the runner's sandbox allows no other way in). The script is classic, not a module, so it runs the same when the
 * runner writes the entry into its frame with document.write.
 *
 * Boo Blocks carries no third-party code: its textures are drawn and its sounds synthesized by its own script. The build
 * fails if a module from node_modules ever reaches the page, so a dependency added later cannot ship without its
 * licence notice being thought about first (see ghostly-chess's vite.config.ts for how that is done).
 */
import { defineConfig, type Plugin } from "vite";

function singleFile(): Plugin {
  return {
    name: "ghostly-mini-app-single-file",
    enforce: "post",
    generateBundle(_options, bundle) {
      const files = Object.values(bundle);
      const html = files.find((f) => f.type === "asset" && f.fileName.endsWith(".html"));
      const chunks = files.filter((f) => f.type === "chunk");
      const styles = files.filter((f) => f.type === "asset" && f.fileName.endsWith(".css"));
      if (!html || html.type !== "asset" || chunks.length !== 1 || chunks[0].type !== "chunk") {
        return this.error("expected one HTML page and one script chunk");
      }
      const chunk = chunks[0];
      const others = files.filter((f) => f !== html && f !== chunk && !styles.includes(f));
      if (others.length) return this.error(`files that cannot be inlined: ${others.map((f) => f.fileName).join(", ")}`);
      const foreign = Object.keys(chunk.modules).filter((id) => id.replace(/\\/g, "/").includes("/node_modules/"));
      if (foreign.length) return this.error(`third-party modules in the page, with no notice: ${foreign.join(", ")}`);
      const code = chunk.code;
      const css = styles.map((s) => (s.type === "asset" ? String(s.source).replace(/\/\*\$vite\$:\d+\*\/\s*/g, "") : "")).join("\n");
      for (const [what, text, bad] of [["script", code, /<\/script|<!--/i], ["styles", css, /<\/style/i]] as const) {
        if (bad.test(text)) return this.error(`the ${what} contains text that would end its tag early`);
      }
      // The page is written here whole rather than edited from Vite's: index.html is only the dev server's entry.
      html.source = [
        "<!doctype html>",
        '<html lang="en">',
        "  <head>",
        '    <meta charset="utf-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />',
        "    <title>Boo Blocks</title>",
        `    <style>\n${css}</style>`,
        "  </head>",
        "  <body>",
        '    <div id="app"></div>',
        `    <script>\n/*! Boo Blocks, a Ghostly mini-app. MIT License, Copyright (c) 2026 Miguel Medeiros. */\n(() => {\n${code}\n})();\n</script>`,
        "  </body>",
        "</html>",
        "",
      ].join("\n");
      delete bundle[chunk.fileName];
      for (const s of styles) delete bundle[s.fileName];
    },
  };
}

export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [singleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    modulePreload: false,
    reportCompressedSize: false,
  },
});
