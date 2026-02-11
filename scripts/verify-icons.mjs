#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const ICONS_DIR = path.join(PUBLIC_DIR, "icons");

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function existsFromPublic(relPath) {
  return fs.existsSync(path.join(PUBLIC_DIR, relPath));
}

function collectHtmlRefs(indexHtml) {
  const refs = [];
  const re = /href="%BASE_URL%([^"]+)"/g;
  let m;
  while ((m = re.exec(indexHtml)) !== null) {
    refs.push(m[1]);
  }
  return refs;
}

function collectManifestRefs(manifestJson) {
  const refs = [];
  for (const icon of manifestJson.icons ?? []) {
    if (typeof icon.src === "string" && icon.src.length > 0) {
      refs.push(icon.src);
    }
  }
  return refs;
}

function collectTsxIconRefs(tsx) {
  const refs = [];
  const re = /icons\/([^"`\s]+\.png)/g;
  let m;
  while ((m = re.exec(tsx)) !== null) {
    refs.push(`icons/${m[1]}`);
  }
  return refs;
}

function unique(values) {
  return [...new Set(values)];
}

function main() {
  const indexHtmlPath = path.join(ROOT, "index.html");
  const manifestPath = path.join(PUBLIC_DIR, "manifest.webmanifest");
  const appTsxPath = path.join(ROOT, "src", "app", "App.tsx");

  const missing = [];

  const htmlRefs = collectHtmlRefs(readFile(indexHtmlPath));
  for (const ref of htmlRefs) {
    if (!existsFromPublic(ref)) {
      missing.push(`index.html -> public/${ref}`);
    }
  }

  const manifestRefs = collectManifestRefs(
    JSON.parse(readFile(manifestPath))
  );
  for (const ref of manifestRefs) {
    if (!existsFromPublic(ref)) {
      missing.push(`manifest.webmanifest -> public/${ref}`);
    }
  }

  const tsxRefs = collectTsxIconRefs(readFile(appTsxPath));
  for (const ref of tsxRefs) {
    if (!existsFromPublic(ref)) {
      missing.push(`src/app/App.tsx -> public/${ref}`);
    }
  }

  if (!fs.existsSync(ICONS_DIR)) {
    missing.push("Missing directory: public/icons");
  }

  const report = unique(missing);
  if (report.length > 0) {
    console.error("Icon verification failed.");
    for (const line of report) {
      console.error(`- ${line}`);
    }
    process.exit(1);
  }

  console.log("Icon verification OK.");
}

main();
