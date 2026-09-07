import { describe, expect, it } from "bun:test";
import { LOCALES, isRtl } from "@kmerhosting/i18n";
import { domainOpsCopy } from "../src/domain-ops-i18n.ts";

describe("domain customer operations locale coverage", () => {
  it("provides forwarding, glue and contact labels for every locale", () => {
    for (const locale of LOCALES) {
      const copy = domainOpsCopy(locale.code);
      expect(copy.forwarding).toBeString();
      expect(copy.glueHosts).toBeString();
      expect(copy.contacts).toBeString();
    }
  });
  it("keeps RTL metadata supported", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("fa")).toBe(true);
    expect(isRtl("ur")).toBe(true);
  });
});
