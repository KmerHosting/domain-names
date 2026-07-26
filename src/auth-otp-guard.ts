function visibleEmailInput(): HTMLInputElement | null {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="email"], input[type="email"], input[autocomplete="email"]'));
  return inputs.find((input) => input.offsetParent !== null) || inputs[0] || null;
}

function showAuthMessage(message: string, kind: "error" | "success" = "error") {
  const card = document.querySelector<HTMLElement>(".auth-card") || document.body;
  let box = document.getElementById("khd-auth-otp-message");
  if (!box) {
    box = document.createElement("div");
    box.id = "khd-auth-otp-message";
    const tabs = card.querySelector(".auth-tabs");
    if (tabs?.parentElement === card) tabs.insertAdjacentElement("afterend", box);
    else card.prepend(box);
  }
  box.className = kind === "success" ? "khd-auth-inline-success" : "khd-auth-inline-error";
  box.textContent = message;
}

function clearAuthMessage() {
  document.getElementById("khd-auth-otp-message")?.remove();
}

function installOtpEmptyEmailGuard() {
  if ((window as any).__khdOtpEmptyEmailGuardInstalled) return;
  (window as any).__khdOtpEmptyEmailGuardInstalled = true;

  document.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement | null;
    if (target?.matches?.('input[name="email"], input[type="email"], input[autocomplete="email"]') && target.value.trim()) clearAuthMessage();
  }, true);

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest?.("button") as HTMLButtonElement | null;
    if (!button) return;
    if (!/sign in with a code/i.test(button.textContent || "")) return;

    const emailInput = visibleEmailInput();
    const email = emailInput?.value.trim() || "";
    if (email) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    emailInput?.focus();
    showAuthMessage("Enter your email address before requesting a sign-in code.");
  }, true);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installOtpEmptyEmailGuard, { once: true });
else installOtpEmptyEmailGuard();
