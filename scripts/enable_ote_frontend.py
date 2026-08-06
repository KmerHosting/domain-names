from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if new in source:
        return source
    if old not in source:
        raise SystemExit(f"Missing expected marker for {label}")
    return source.replace(old, new, 1)


router_path = Path("src/router.tsx")
router = router_path.read_text(encoding="utf-8")
router = replace_once(
    router,
    "  newIdempotencyKey,\n  setSession,",
    "  newIdempotencyKey,\n  orderGuardApi,\n  setSession,",
    "router orderGuardApi import",
)
router = replace_once(
    router,
    'mutationFn: (body: Row) => api<{ order: Order; quote: Row }>(type === "registration" ? "/orders/registration" : "/orders/transfer", { method: "POST", body, idempotencyKey: newIdempotencyKey(type) }),',
    'mutationFn: (body: Row) => orderGuardApi<{ order: Order; quote: Row; billing?: Row }>(type === "registration" ? "/registration" : "/transfer", { method: "POST", body, idempotencyKey: newIdempotencyKey(type) }),',
    "router guarded order mutation",
)
router = router.replace(
    "Creating an order does not debit the provider. Payment is made separately from your USD account balance.",
    "Creating the order does not charge your balance. You review and pay it separately from your USD account balance.",
)
router = router.replace(
    "<strong>Test domain.</strong> Provider changes use OTE. Live billing is blocked.",
    "<strong>Test domain.</strong> Orders, wallet debits and domain changes stay inside the OTE test environment.",
)
router_path.write_text(router, encoding="utf-8")

purchase_path = Path("src/purchase-page.tsx")
purchase = purchase_path.read_text(encoding="utf-8")
purchase = replace_once(
    purchase,
    "  newIdempotencyKey,\n}",
    "  newIdempotencyKey,\n  orderGuardApi,\n}",
    "purchase orderGuardApi import",
)
purchase = replace_once(
    purchase,
    'const payload = await api<OrderResponse>(`/orders/${type}`, {',
    'const payload = await orderGuardApi<OrderResponse>(`/${type}`, {',
    "purchase guarded order call",
)
purchase = purchase.replace(
    "The provider is checked before the order is created. Creating an order does not debit DomainNameAPI.\n          Payment is made separately from your USD account balance.",
    "Availability and exact pricing are checked before the order is created. Your balance is charged only when you pay the order.",
)
purchase_path.write_text(purchase, encoding="utf-8")

native_path = Path("src/native-pages.tsx")
native = native_path.read_text(encoding="utf-8")
native = native.replace(
    "<strong>TEST / OTE domain.</strong> Actions on this domain use DomainNameAPI OTE. Live billing, wallet debit and production purchases are blocked.",
    "<strong>TEST / OTE domain.</strong> Domain actions and wallet debits stay in the test environment. Production purchases and the production provider balance remain untouched.",
)
native_path.write_text(native, encoding="utf-8")
