import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const main = fs.readFileSync(path.join(root, "src/main.tsx"), "utf8");
const experience = fs.readFileSync(path.join(root, "src/carbon-experience.tsx"), "utf8");
const shell = fs.readFileSync(path.join(root, "src/domain-shell.tsx"), "utf8");
const alignment = fs.readFileSync(path.join(root, "src/carbon-alignment.scss"), "utf8");
const violations = [];

if (!pkg.dependencies?.["@carbon/react"]) {
  violations.push("Missing @carbon/react production dependency.");
}
if (!pkg.devDependencies?.sass) {
  violations.push("Sass is required for Carbon foundation APIs.");
}

for (const required of [
  "DomainCarbonExperience",
  "DomainApplicationShell",
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
  "GlobalTheme",
  "useSyncExternalStore",
  "prefers-color-scheme: dark",
  '"g10"',
  '"g90"',
  "dataset.carbonTheme",
  "colorScheme",
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

if (/#[0-9a-f]{3,8}\b/i.test(alignment)) {
  violations.push("Raw hexadecimal color found in src/carbon-alignment.scss; use Carbon semantic tokens.");
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

// Legacy route implementations are migrated incrementally. The new global
// shell is canonical Carbon now, and this debt ceiling prevents regressions
// while individual forms/tables are converted to Carbon React components.
const MAX_NATIVE_CONTROL_DEBT = 148;
const MAX_LUCIDE_IMPORT_DEBT = 2;
if (nativeControlMatches > MAX_NATIVE_CONTROL_DEBT) {
  violations.push(`Native control/table migration debt increased from ${MAX_NATIVE_CONTROL_DEBT} to ${nativeControlMatches}.`);
}
if (lucideImports > MAX_LUCIDE_IMPORT_DEBT) {
  violations.push(`Lucide migration debt increased from ${MAX_LUCIDE_IMPORT_DEBT} to ${lucideImports}.`);
}

const styleFiles = fs.readdirSync(path.join(root, "src"))
  .filter((file) => /\.(?:css|scss)$/.test(file))
  .map((file) => fs.readFileSync(path.join(root, "src", file), "utf8"))
  .join("\n");
if (/\.cds--loading-overlay|--cds-overlay\s*:/.test(styleFiles)) {
  violations.push("Do not override the Carbon loading overlay or --cds-overlay token.");
}

if (pkg.version !== "1.2.1") {
  violations.push("Expected the current domain portal version to remain 1.2.1 during the UI refactor.");
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
console.log("Dashboard-aligned G10/G90 theme and canonical Carbon UI shell are guarded.");
console.log(`Legacy component migration debt: ${nativeControlMatches} native control/table usages; ${lucideImports} lucide-react import sites.`);
