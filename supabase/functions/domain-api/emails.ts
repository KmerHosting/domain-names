import { Json, clean, dateOnly, escapeHtml, getConfig } from "./core.ts";

export async function renderEmail(template: string, payload: Json): Promise<{ subject?: string; text: string; html: string; category: string }> {
  const cfg = await getConfig();
  const name = clean(payload.name) || "Customer";
  const domain = clean(payload.domainName);
  const order = clean(payload.orderNumber);
  const paymentUrl = clean(payload.paymentUrl);
  const expires = dateOnly(payload.expiresAt);
  let title = "KmerHosting Domains";
  let paragraphs: string[] = [];
  let action = "";

  switch (template) {
    case "order_paid":
      title = "Payment confirmed";
      paragraphs = [`Your payment for ${domain || order} has been confirmed.`, `Order: ${order}`];
      break;
    case "domain_ready":
      title = `${domain} is ready`;
      paragraphs = [`Your domain ${domain} has been provisioned successfully.`, expires ? `Expiration date: ${expires}` : "", "You can now manage nameservers, DNS records and auto-renewal from your dashboard."].filter(Boolean);
      action = `${cfg.site_url}/dashboard/domains`;
      break;
    case "domain_failed":
      title = `Action required for ${domain}`;
      paragraphs = [`The automated operation for ${domain} could not be completed.`, clean(payload.message) || "The system will retry automatically when appropriate.", `Order: ${order}`];
      action = `${cfg.site_url}/dashboard/orders`;
      break;
    case "renewal_reminder":
      title = `${domain} expires in ${payload.days} day${Number(payload.days) === 1 ? "" : "s"}`;
      paragraphs = [`Your domain ${domain} expires on ${expires}.`, payload.autoRenew ? "Auto-renewal is enabled. A renewal payment request will be prepared automatically." : "Auto-renewal is disabled. Renew it now to avoid interruption."];
      action = `${cfg.site_url}/dashboard/domains`;
      break;
    case "renewal_payment_required":
      title = `Renewal payment required for ${domain}`;
      paragraphs = [`A renewal order was prepared automatically for ${domain}.`, "Complete the payment to let the system renew the domain without manual support."];
      action = paymentUrl || `${cfg.site_url}/dashboard/orders`;
      break;
    case "transfer_started":
      title = `Transfer started for ${domain}`;
      paragraphs = [`The transfer request for ${domain} has been submitted.`, "Transfer completion can depend on registry approval and the current registrar. The platform will keep checking the status automatically."];
      action = `${cfg.site_url}/dashboard/domains`;
      break;
    default:
      title = clean(payload.title) || "KmerHosting Domains notification";
      paragraphs = [clean(payload.message) || "There is an update in your domain account."];
      action = clean(payload.actionUrl);
  }

  const text = `Hello ${name},\n\n${title}\n\n${paragraphs.join("\n\n")}${action ? `\n\nOpen: ${action}` : ""}\n\nSupport: ${cfg.support_email}\nKmerHosting LLC`;
  const htmlParagraphs = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  const button = action ? `<p><a href="${escapeHtml(action)}" style="display:inline-block;background:#155eef;color:#fff;padding:12px 18px;border-radius:9px;text-decoration:none;font-weight:600">Open dashboard</a></p>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#172033"><div style="max-width:600px;margin:30px auto;background:#fff;border:1px solid #e5eaf2;border-radius:16px;padding:30px"><div style="font-size:13px;color:#667085">KmerHosting Domains</div><h2>${escapeHtml(title)}</h2><p>Hello ${escapeHtml(name)},</p>${htmlParagraphs}${button}<hr style="border:0;border-top:1px solid #e5eaf2;margin:28px 0"><p style="font-size:13px;color:#667085">Support: ${escapeHtml(cfg.support_email)}<br>KmerHosting LLC</p></div></body></html>`;
  return { text, html, category: `domain-${template}` };
}
