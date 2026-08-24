import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const config = fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8");
const violations = [];

const browserFunctions = [
  "domain-api",
  "domain-platform-status",
  "domain-search-fast",
  "domain-documents",
  "domain-order-guard",
  "domain-customer-tools",
  "domain-dns-tools",
];

const protectedFunctions = [
  "domain-documents",
  "domain-order-guard",
  "domain-customer-tools",
  "domain-dns-tools",
];

const automationFunctions = ["domain-jobs-v2"];

const retiredFunctions = [
  "domain-admin-user-safety",
  "domain-admin",
  "domain-automation-v2",
  "domain-dns-auto-sync",
  "domain-environment-status",
  "domain-environment-switch",
  "domain-operations-monitor",
  "domain-payment-status",
  "domain-provider-balance",
  "domain-tld-provider-sync",
  "domain-tld-sync-worker",
  "domain-wallet",
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

for (const name of retiredFunctions) {
  const sourcePath = path.join(root, "supabase/functions", name, "index.ts");
  if (!fs.existsSync(sourcePath)) {
    violations.push(`Missing retired-service tombstone: ${name}.`);
    continue;
  }
  const source = fs.readFileSync(sourcePath, "utf8");
  for (const required of ["legacy_domain_service_removed", "status: 410"]) {
    if (!source.includes(required)) violations.push(`${name} is missing retired-service marker: ${required}.`);
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

console.log(`Domain session gateway audit passed: ${browserFunctions.length} active browser APIs are configured, ${protectedFunctions.length} protected APIs retain KmerHosting session validation, ${automationFunctions.length} cron worker retains custom-secret authentication, and ${retiredFunctions.length} legacy services remain closed with HTTP 410 tombstones.`);
