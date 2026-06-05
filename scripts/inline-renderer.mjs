import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rendererDir = path.join(root, "renderer-dist");
const rootIndexPath = path.join(root, "index.html");

async function readAsset(assetPath) {
  const normalized = assetPath.replace(/^\.\//, "");
  return await fs.readFile(path.join(rendererDir, normalized), "utf8");
}

const htmlFiles = (await fs.readdir(rendererDir)).filter((name) => name.endsWith(".html"));
const htmlName = htmlFiles.includes("index.html") ? "index.html" : htmlFiles[0];
if (!htmlName) {
  throw new Error("renderer-dist does not contain an HTML entry.");
}

let html = await fs.readFile(path.join(rendererDir, htmlName), "utf8");

for (const match of [...html.matchAll(/<link\s+rel="stylesheet"\s+crossorigin\s+href="([^"]+)">/g)]) {
  const css = await readAsset(match[1]);
  html = html.replace(match[0], () => `<style>\n${css}\n</style>`);
}

for (const match of [...html.matchAll(/<script\s+type="module"\s+crossorigin\s+src="([^"]+)"><\/script>/g)]) {
  const code = (await readAsset(match[1])).replace(/<\/script/gi, "<\\/script");
  html = html.replace(match[0], () => `<script type="module">\n${code}\n</script>`);
}

html = html.replace(/<link rel="icon" type="image\/svg\+xml" href="\.\/favicon\.svg" \/>\n\s*/g, "");
html = html.replace("<html lang=\"en\">", "<html lang=\"zh-CN\">");
html = html.replace(
  "<head>",
  "<head>\n    <!-- Standalone build: double-click this file for the web preview. Desktop serial APIs require the EXE. -->",
);

await fs.writeFile(rootIndexPath, html, "utf8");

if (htmlName !== "index.html") {
  await fs.copyFile(path.join(rendererDir, htmlName), path.join(rendererDir, "index.html"));
}
