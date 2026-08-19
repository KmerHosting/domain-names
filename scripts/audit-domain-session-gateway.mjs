import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const config = fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8");
const violations = [];

const browserFunctions = [
  "domain-api",
  "domain-platform-status",
  "domain-search-fast",
  "domain-wallet",
  "domain-admin",
  "domain-admin-user-safety",
  "domain-admin-monitor",
  "domain-operations-monitor",
  "domain-ops",
  "domain-documents",
  "domain-order-guard",
  "domain-customer-tools",
  "domain-dns-tools",
  "domain-provider-balance",
  "domain-environment-status",
  "domain-environment-switch",
  "domain-environment-credit",
  "domain-tld-provider-sync",
];

const protectedFunctions = [
  "domain-wallet",
  "domain-admin",
  "domain-admin-user-safety",
  "domain-operations-monitor",
  "domain-documents",
  "domain-order-guard",
  "domain-customer-tools",
  "domain-dns-tools",
  "domain-provider-balance",
  "domain-environment-status",
  "domain-environment-switch",
  "domain-tld-provider-sync",
];

const automationFunctions = [
  "domain-jobs-v2",
  "domain-automation-v2",
];

function sectionFor(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = config.match(new RegExp(`\\[functions\\.${escaped}\\]([\\s\\S]*?)(?=\\n\\[|$)`));
  return match?.[1] || "";
}

for (const name of browserFunctions) {
  const section = sectionFor(name);
  if (!section) {
    violations.push(`Missing Supabase function configuration section for ${name}.`);
    continue;
  }
  if (!/verify_jwt\s*=\s*false/.test(section)) {
    violations.push(`${name} must use verify_jwt=false because browser requests carry the KmerHosting opaque domain session token, not a Supabase Auth JWT.`);
  }
}

for (const name of protectedFunctions) {
  const sourcePath = path.join(root, "supabase/functions", name, "index.ts");
  if (!fs.existsSync(sourcePath)) {
    violations.push(`Missing protected function source: ${name}.`);
    continue;
  }
  const source = fs.readFileSync(sourcePath, "utf8");
  for (const required of ["authorization", "domain_sessions", "token_hash", "revoked_at", "expires_at", "domain_users", "session_version"]) {
    if (!source.includes(required)) violations.push(`${name} is missing custom-session validation marker: ${required}.`);
  }
}

for (const name of automationFunctions) {
  const section = sectionFor(name);
  if (!section) {
    violations.push(`Missing Supabase function configuration section for ${name}.`);
    continue;
  }
  if (!/verify_jwt\s*=\s*false/.test(section)) {
    violations.push(`${name} must use verify_jwt=false because cron requests authenticate inside the function with x-domain-cron-secret.`);
  }

  const sourcePath = path.join(root, "supabase/functions", name, "index.ts");
  if (!fs.existsSync(sourcePath)) {
    violations.push(`Missing automation function source: ${name}.`);
    continue;
  }
  const source = fs.readFileSync(sourcePath, "utf8");
  for (const required of ["x-domain-cron-secret", "domain_internal_cron_secret"]) {
    if (!source.includes(required)) violations.push(`${name} is missing internal automation authentication marker: ${required}.`);
  }
}

const publicSearch = fs.readFileSync(path.join(root, "supabase/functions/domain-search-fast/index.ts"), "utf8");
for (const required of ["domain_rate_limits", "bulk-domain-search", "checkoutEnvironment"]) {
  if (!publicSearch.includes(required)) violations.push(`domain-search-fast is missing public-search protection/config marker: ${required}.`);
}

if (violations.length) {
  console.error("Domain session gateway audit failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Domain session gateway audit passed: ${browserFunctions.length} browser APIs bypass Supabase JWT interception, protected APIs retain KmerHosting session validation, and ${automationFunctions.length} cron workers retain custom-secret authentication.`);
