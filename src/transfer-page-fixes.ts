function fixTransferPeriod() {
  if (window.location.pathname !== "/transfer-domain") return;
  const select = document.querySelector<HTMLSelectElement>('select[name="years"]');
  if (!select) return;
  select.value = "1";
  const label = select.closest("label") as HTMLElement | null;
  if (label) label.style.display = "none";
  if (document.getElementById("khd-transfer-period-note")) return;
  const contactLabel = document.querySelector<HTMLSelectElement>('select[name="contactId"]')?.closest("label");
  const note = document.createElement("div");
  note.id = "khd-transfer-period-note";
  note.className = "alert alert-warning";
  note.textContent = "Domain transfers are submitted for one year. Renew the domain later from your dashboard.";
  contactLabel?.parentElement?.insertAdjacentElement("beforebegin", note);
}

function runTransferFix() {
  fixTransferPeriod();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", runTransferFix, { once: true });
else runTransferFix();
new MutationObserver(runTransferFix).observe(document.body, { childList: true, subtree: true });
