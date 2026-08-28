import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import {
  normalizeProviderRecord,
  providerRecordList,
  relativeProviderName,
} from "../supabase/functions/domain-dns-tools/dns-zone-normalization.ts";

describe("provider-authoritative DNS reconciliation", () => {
  test("normalizes the provider's FQDN owner names for the local editor", () => {
    expect(relativeProviderName("www.kmerhosting.space.", "kmerhosting.space")).toBe("www");
    expect(relativeProviderName("kmerhosting.space.", "kmerhosting.space")).toBe("@");
  });

  test("imports the actual DomainNameAPI zone response shape", () => {
    const provider = [
      {
        ttl: 3600,
        name: "www.kmerhosting.space.",
        type: "A",
        records: [{ content: "84.247.132.49", disabled: false }],
        changeType: "",
      },
    ];
    const rows = providerRecordList(provider);
    expect(rows).toHaveLength(1);
    expect(normalizeProviderRecord(rows[0], "kmerhosting.space")).toMatchObject({
      name: "www",
      type: "A",
      ttl: 3600,
      contents: ["84.247.132.49"],
      status: "active",
      record_key: "www::A",
    });
  });

  test("keeps unapplied provider changes pending", () => {
    const record = normalizeProviderRecord({
      name: "mail.example.com.",
      type: "MX",
      records: [{ content: "10 mx.example.net." }],
      changeType: "Update",
    }, "example.com");
    expect(record.status).toBe("pending");
    expect(record.provider_operation).toBe("update");
  });

  test("does not regress to ON CONFLICT against the partial unique index", () => {
    const source = fs.readFileSync(new URL("../supabase/functions/domain-dns-tools/index.ts", import.meta.url), "utf8");
    expect(source).not.toContain(".upsert(");
    expect(source).toContain("fetchAndReconcileProviderZone");
    expect(source).toContain('searchParams.get("refresh") === "1"');
    expect(source).toContain("records.length === 0");
    expect(source).toContain("await applyZone(d)");
    expect(source).toContain("dns_retry_not_required");
    expect(source).toContain("dns_retry_not_confirmed");
  });
});
