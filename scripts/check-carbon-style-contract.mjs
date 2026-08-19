import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const main = fs.readFileSync(path.join(root, "src/main.tsx"), "utf8");
const experience = fs.readFileSync(path.join(root, "src/carbon-experience.tsx"), "utf8");
const shell = fs.readFileSync(path.join(root, "src/domain-shell.tsx"), "utf8");
const alignment = fs.readFileSync(path.join(root, "src/carbon-alignment.scss"), "utf8");
const contrast = fs.readFileSync(path.join(root, "src/carbon-theme-contrast-fixes.scss"), "utf8");
const violations = [];

if (!pkg.dependencies?.["@carbon/react"]) {
  violations.push("Missing @carbon/react production dependency.");
}
if (pkg.dependencies?.["lucide-react"]) {
  violations.push("lucide-react is not allowed in the Carbon-aligned domain portal; use @carbon/react/icons.");
}
if (!pkg.devDependencies?.sass) {
  violations.push("Sass is required for Carbon foundation APIs.");
}

for (const required of [
  "DomainCarbonExperience",
  "DomainApplicationShell",
  'import "./carbon-alignment.scss";',
  'import "./carbon-theme-contrast-fixes.scss";',
]) {
  if (!main.includes(required)) violations.push(`src/main.tsx is missing Carbon root wiring: ${required}`);
}

const cssImports = [...main.matchAll(/import\s+"\.\/[^\"]+\.(?:css|scss)";/g)];
const lastCssImport = cssImports.at(-1)?.[0] || "";
if (lastCssImport !== 'import "./carbon-theme-contrast-fixes.scss";') {
  violations.push("src/carbon-theme-contrast-fixes.scss must be the final application stylesheet import.");
}

for (const required of [
  "GlobalTheme",
  "Theme",
  "useSyncExternalStore",
  "prefers-color-scheme: dark",
  '"g10"',
  '"g90"',
  "dataset.carbonTheme",
  "colorScheme",
  "domain-theme-root",
  "Loading",
  "withOverlay",
  "SkeletonText",
  "SkeletonPlaceholder",
  "Layer",
  "DomainLoadingScreen",
  "domain-route-stage",
]) {
  if (!experience.includes(required)) violations.push(`Carbon experience layer is missing: ${required}`);
}

for (const required of [
  "HeaderContainer",
  "HeaderMenuButton",
  "HeaderGlobalAction",
  "HeaderPanel",
  "SideNav",
  "SideNavDivider",
  "SideNavLink",
  "SkipToContent",
  "isRail",
  "isChildOfHeader",
  "domain-carbon-sidenav",
  "onOverlayClick={isSideNavExpanded ? onClickSideNavExpand : undefined}",
  'from "@carbon/react/icons"',
  "CUSTOMER_DASHBOARD_URL",
  "https://domain.kmerhosting.com/dashboard",
  "Customer dashboard",
]) {
  if (!shell.includes(required)) violations.push(`Canonical Carbon shell is missing: ${required}`);
}

for (const required of [
  "@use '@carbon/react'",
  "@use '@carbon/react/scss/theme'",
  "@use '@carbon/react/scss/themes'",
  "@use '@carbon/react/scss/spacing'",
  "@use '@carbon/react/scss/type'",
  "@use '@carbon/react/scss/breakpoint'",
  "@use '@carbon/react/scss/motion'",
  "carbon-theme.theme(carbon-themes.$white)",
  "carbon-theme.theme(carbon-themes.$g10)",
  "carbon-theme.theme(carbon-themes.$g90)",
  "carbon-theme.theme(carbon-themes.$g100)",
  "motion.motion(entrance, productive)",
  "prefers-reduced-motion: reduce",
  "var(--cds-background)",
  "var(--cds-text-primary)",
  "var(--cds-layer-01)",
  ".domain-header-panel",
  ".domain-carbon-sidenav",
  "margin-inline-start: 3rem",
  "margin-inline-start: 16rem",
]) {
  if (!alignment.includes(required)) violations.push(`Carbon foundation layer is missing: ${required}`);
}

for (const required of [
  ".domain-theme-root",
  ".footer",
  "var(--cds-background)",
  "var(--cds-text-primary)",
  "var(--cds-text-secondary)",
  "var(--cds-background-inverse)",
  "var(--cds-text-inverse)",
  "var(--cds-link-inverse)",
  "var(--cds-link-inverse-hover)",
]) {
  if (!contrast.includes(required)) violations.push(`Carbon theme contrast layer is missing: ${required}`);
}

if (/#[0-9a-f]{3,8}\b/i.test(alignment)) {
  violations.push("Raw hexadecimal color found in src/carbon-alignment.scss; use Carbon semantic tokens.");
}
if (/#[0-9a-f]{3,8}\b/i.test(contrast)) {
  violations.push("Raw hexadecimal color found in src/carbon-theme-contrast-fixes.scss; use Carbon semantic tokens.");
}

const mediaQueries = [...alignment.matchAll(/@media\s*\(([^)]+)\)/g)].map((match) => match[1].trim());
for (const media of mediaQueries) {
  if (media !== "prefers-reduced-motion: reduce") {
    violations.push(`Handwritten responsive media query found in src/carbon-alignment.scss (${media}); use Carbon breakpoint mixins.`);
  }
}

const sourceFiles = fs.readdirSync(path.join(root, "src"))
  .filter((file) => /\.(?:ts|tsx)$/.test(file))
  .map((file) => path.join(root, "src", file));
const source = sourceFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const nativeControlMatches = (source.match(/<(?:button|input|select|textarea|table)\b/g) || []).length;
const lucideImports = (source.match(/from\s+["']lucide-react["']/g) || []).length;

if (/<style(?:\s|>)/.test(source)) {
  violations.push("Inline <style> islands are not allowed in UI source; use Carbon Sass modules and semantic tokens.");
}
if (nativeControlMatches !== 0) {
  violations.push(`Native UI controls/tables are prohibited in React source; found ${nativeControlMatches}. Use @carbon/react components.`);
}
if (lucideImports !== 0) {
  violations.push(`Lucide imports are prohibited; found ${lucideImports}. Use @carbon/react/icons.`);
}

const styleFiles = fs.readdirSync(path.join(root, "src"))
  .filter((file) => /\.(?:css|scss)$/.test(file))
  .map((file) => fs.readFileSync(path.join(root, "src", file), "utf8"))
  .join("\n");
if (/\.cds--loading-overlay|--cds-overlay\s*:/.test(styleFiles)) {
  violations.push("Do not override the Carbon loading overlay or --cds-overlay token.");
}

if (!/^\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/.test(pkg.version || "")) {
  violations.push("package.json must expose a valid semantic release version.");
}
if (!pkg.scripts?.check) {
  violations.push("package.json must expose a full check command.");
}

if (violations.length) {
  console.error("Carbon source-alignment contract failed:");
  for (const item of violations) console.error(`- ${item}`);
  process.exit(1);
}

console.log("Carbon foundation/source alignment OK.");
console.log("Dashboard-aligned G10/G90 theme, inverse contrast and canonical Carbon UI shell are guarded.");
console.log("Carbon component migration debt: 0 native control/table usages; 0 lucide-react import sites.");
