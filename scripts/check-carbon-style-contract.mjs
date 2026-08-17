import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const main = fs.readFileSync(path.join(root, "src/main.tsx"), "utf8");
const alignment = fs.readFileSync(path.join(root, "src/carbon-alignment.scss"), "utf8");
const violations = [];

if (!pkg.dependencies?.["@carbon/react"]) {
  violations.push("Missing @carbon/react production dependency.");
}
if (!pkg.devDependencies?.sass) {
  violations.push("Sass is required for Carbon foundation APIs.");
}

for (const required of [
  'GlobalTheme',
  'theme="white"',
  'document.documentElement.dataset.carbonTheme = "white"',
  'import "./carbon-alignment.scss";',
]) {
  if (!main.includes(required)) violations.push(`src/main.tsx is missing Carbon root wiring: ${required}`);
}

const cssImports = [...main.matchAll(/import\s+"\.\/[^\"]+\.(?:css|scss)";/g)];
const lastCssImport = cssImports.at(-1)?.[0] || "";
if (lastCssImport !== 'import "./carbon-alignment.scss";') {
  violations.push("src/carbon-alignment.scss must be the final application stylesheet import.");
}

for (const required of [
  "@use '@carbon/react'",
  "@use '@carbon/react/scss/theme'",
  "@use '@carbon/react/scss/themes'",
  "@use '@carbon/react/scss/spacing'",
  "@use '@carbon/react/scss/type'",
  "@use '@carbon/react/scss/breakpoint'",
  "theme.theme(themes.$white)",
  "var(--cds-background)",
  "var(--cds-text-primary)",
  "var(--cds-layer-01)",
]) {
  if (!alignment.includes(required)) violations.push(`Carbon foundation layer is missing: ${required}`);
}

if (/#[0-9a-f]{3,8}\b/i.test(alignment)) {
  violations.push("Raw hexadecimal color found in src/carbon-alignment.scss; use Carbon semantic tokens.");
}
if (/@media\s*\(/.test(alignment)) {
  violations.push("Handwritten media query found in src/carbon-alignment.scss; use Carbon breakpoint mixins.");
}

const sourceFiles = fs.readdirSync(path.join(root, "src"))
  .filter((file) => /\.(?:ts|tsx)$/.test(file))
  .map((file) => path.join(root, "src", file));
const source = sourceFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const nativeControlMatches = (source.match(/<(?:button|input|select|textarea|table)\b/g) || []).length;
const lucideImports = (source.match(/from\s+["']lucide-react["']/g) || []).length;

if (violations.length) {
  console.error("Carbon source-alignment contract failed:");
  for (const item of violations) console.error(`- ${item}`);
  process.exit(1);
}

console.log("Carbon foundation/source alignment OK.");
console.log(`Legacy component migration debt: ${nativeControlMatches} native control/table usages; ${lucideImports} lucide-react import sites.`);
console.log("These legacy counts are reported intentionally and must trend toward zero as screens migrate to Carbon components and Carbon icons.");
