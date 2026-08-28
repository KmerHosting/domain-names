import { describe, expect, test } from "bun:test";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

describe("domain lifecycle safety", () => {
  test("registration and transfer require a Carbon review modal and stable idempotency key", () => {
    const source = read("../src/router.tsx");
    expect(source).toContain("onSubmit={reviewOrder}");
    expect(source).toContain("Confirm domain registration");
    expect(source).toContain("idempotencyKey: orderKey");
    expect(source).toContain("expectedPriceUsd: dueNow");
  });

  test("a changed provider price is rejected before balance or checkout work", () => {
    const source = read("../supabase/functions/domain-order-guard/index.ts");
    const priceGuard = source.indexOf('"price_changed"');
    const balanceCheck = source.indexOf("await providerBalance(environment, providerCost)");
    const checkout = source.indexOf("await checkoutOrder(user.id, order.id)", balanceCheck);
    expect(priceGuard).toBeGreaterThan(0);
    expect(priceGuard).toBeLessThan(balanceCheck);
    expect(balanceCheck).toBeLessThan(checkout);
  });

  test("unsupported restore is represented as unavailable instead of a broken action", () => {
    const source = read("../src/native-pages.tsx");
    expect(source).toContain("Unavailable from provider API");
    expect(source).not.toContain('getQuote.mutate("restore")');
    expect(source).not.toContain('createOrder.mutate(quote.operation)');
  });

  test("every DNS proxy exposes the idempotent apply retry route", () => {
    for (const path of [
      "../api/domain-proxy.ts",
      "../api/domain/[service]/[...path].ts",
      "../api/domain/domain-dns-tools/[...path].ts",
    ]) {
      expect(read(path)).toContain('/retry`');
    }
  });
});
