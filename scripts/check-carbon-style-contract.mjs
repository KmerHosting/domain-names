import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const styleFiles = [
  "src/styles.css",
  "src/admin.css",
  "src/router-compat.css",
  "src/platform-sync.css",
];
const css = styleFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const requiredClasses = [
  "public-header", "auth-shell", "auth-brand-pane", "auth-form-pane", "auth-card", "auth-tabs",
  "password-field", "purchase-layout", "dashboard-shell", "dashboard-sidebar", "sidebar-nav",
  "dashboard-main", "dashboard-header", "dashboard-content", "page-heading", "stats-grid",
  "dashboard-grid", "domain-list", "domain-card", "order-list", "order-card", "activity-list",
  "activity-item", "card", "card-heading", "form-stack", "form-row", "table-wrap",
  "dns-settings-grid", "dns-add-row", "admin-main", "admin-topbar", "admin-nav-inline",
  "admin-tabs", "native-action-card", "loading", "empty-state", "status",
];

const missing = requiredClasses.filter((className) => {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return !new RegExp(`\\.${escaped}(?![a-zA-Z0-9_-])`).test(css);
});

const carbon = fs.readFileSync(path.join(root, "src/platform-sync.css"), "utf8");
for (const token of ["#1A73E8", "#161616", "IBM Plex Sans"]) {
  if (!carbon.includes(token)) missing.push(`Carbon token ${token}`);
}

const main = fs.readFileSync(path.join(root, "src/main.tsx"), "utf8");
const syncImport = 'import "./platform-sync.css";';
const importIndex = main.indexOf(syncImport);
const lastCssImport = Math.max(...[...main.matchAll(/import\s+"\.\/[^\"]+\.css";/g)].map((match) => match.index ?? -1));
if (importIndex < 0 || importIndex !== lastCssImport) {
  missing.push("platform-sync.css must be the final CSS import in src/main.tsx");
}

if (missing.length) {
  console.error("Carbon style contract failed:");
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log(`Carbon style contract OK: ${requiredClasses.length} critical UI classes and Carbon tokens are covered.`);
