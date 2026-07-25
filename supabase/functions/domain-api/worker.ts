import {
  ApiError, Json, addYears, clean, db, decryptSensitive, getConfig, notify, pick,
  queueEmail, randomReference, sendMail,
} from "./core.ts";
import {
  camerPayStatus, createZoneRecord, deleteZoneRecord, domainInfo, isPaymentPaid,
  paymentFields, registerDomain, renewDomain, transferDomain, updateNameServers,
  updateZoneRecord,
} from "./providers.ts";
import { renderEmail } from "./emails.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : clean(error) || "Unknown error";
}

function registrarSuccess(payload: Json): boolean {
  const result = clean(pick(payload, ["result","status","data.result","data.status"])).toLowerCase();
  if (!result) return true;
  return ["ok","success","successful","completed","active","true"].includes(result);
}

function infoFields(payload: Json): { status: string; expiresAt: string | null; registeredAt: string | null; nameServers: string[]; registrarId: string | null; epp: string[] } {
  const rawStatus = clean(pick(payload, ["data.status","status","data.domainStatus","domainStatus"])).toLowerCase();
  const status = rawStatus.includes("transfer") ? "transfer_pending"
    : rawStatus.includes("expire") ? "expired"
    : rawStatus.includes("redemption") ? "redemption"
    : rawStatus.includes("suspend") ? "suspended"
    : rawStatus.includes("fail") ? "failed"
    : "active";
  const expiresAtRaw = pick(payload, ["data.expirationDate","data.expiresAt","expirationDate","expiresAt","data.expireDate"]);
  const registeredAtRaw = pick(payload, ["data.creationDate","data.registeredAt","creationDate","registeredAt"]);
  const parseDate = (v: any) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  const ns = pick(payload, ["data.nameServers","nameServers","data.nameservers","nameservers"]);
  const epp = pick(payload, ["data.eppStatuses","eppStatuses","data.statuses","statuses"]);
  return {
    status,
    expiresAt: parseDate(expiresAtRaw),
    registeredAt: parseDate(registeredAtRaw),
    nameServers: Array.isArray(ns) ? ns.map(clean).filter(Boolean) : [],
    registrarId: clean(pick(payload, ["data.id","data.domainId","domainId","id"])) || null,
    epp: Array.isArray(epp) ? epp.map(clean).filter(Boolean) : rawStatus ? [rawStatus] : [],
  };
}

export async function markPaymentPaid(payment: Json, payload: Json): Promise<void> {
  if (payment.status === "paid" && payment.processed_at) return;
  const now = new Date().toISOString();
  const { data: order, error } = await db.from("domain_orders").select("*,domain_users(*)").eq("id", payment.order_id).single();
  if (error || !order) throw new ApiError(404, "order_not_found", "Payment order was not found.");
  if (!isPaymentPaid(payload, Number(payment.amount_xaf))) return;
  const fields = paymentFields(payload);
  await db.from("domain_payments").update({
    status: "paid", provider_reference: fields.reference || payment.provider_reference,
    raw_payload: payload, paid_at: payment.paid_at || now, processed_at: now,
  }).eq("id", payment.id);
  await db.from("domain_orders").update({ status: "paid", paid_at: order.paid_at || now, updated_at: now }).eq("id", order.id);
  const jobType: Record<string, string> = {
    registration: "register_domain", transfer: "transfer_domain", renewal: "renew_domain", restore: "restore_domain",
  };
  const { error: jobError } = await db.rpc("domain_enqueue_job", {
    p_type: jobType[order.type], p_idempotency_key: `${jobType[order.type]}:${order.id}`,
    p_user_id: order.user_id, p_order_id: order.id, p_domain_id: order.domain_id, p_payload: {},
  });
  if (jobError) throw jobError;
  await db.from("domain_invoices").upsert({
    invoice_number: randomReference("KHD-INV"), user_id: order.user_id, order_id: order.id,
    amount_usd: order.price_usd, amount_xaf: order.amount_xaf, status: "paid",
    metadata: { paymentId: payment.id, merchantInvoiceId: payment.merchant_invoice_id },
  }, { onConflict: "order_id", ignoreDuplicates: true });
  await queueEmail({
    eventKey: `order-paid:${order.id}`, recipientEmail: order.domain_users.email,
    recipientName: order.domain_users.full_name, template: "order_paid", subject: `Payment confirmed — ${order.domain_name}`,
    payload: { name: order.domain_users.full_name, domainName: order.domain_name, orderNumber: order.order_number },
    userId: order.user_id, orderId: order.id,
  });
  await notify(order.user_id, "payment_paid", "Payment confirmed", `Payment for ${order.domain_name} is confirmed. Provisioning is automatic.`, { orderId: order.id });
}

async function processRegister(job: Json): Promise<void> {
  const { data: order, error } = await db.from("domain_orders").select("*,domain_contacts(*),domain_users(*)").eq("id", job.order_id).single();
  if (error || !order) throw new ApiError(404, "order_not_found", "Registration order was not found.");
  if (order.status === "completed") return;
  if (!order.domain_contacts) throw new ApiError(400, "contact_missing", "Registration contact is missing.");
  await db.from("domain_orders").update({ status: "processing" }).eq("id", order.id);
  const response = await registerDomain({
    domainName: order.domain_name, period: Number(order.years), nameServers: order.nameservers,
    contact: order.domain_contacts, privacy: true,
  });
  if (!registrarSuccess(response)) throw new ApiError(502, "registration_failed", "Registrar did not confirm registration.", response);
  const fallbackExpiry = addYears(new Date(), Number(order.years)).toISOString();
  const { data: domain, error: domainError } = await db.from("domain_domains").upsert({
    user_id: order.user_id, contact_id: order.contact_id, domain_name: order.domain_name, tld: order.tld,
    registrar_order_id: clean(pick(response, ["data.orderId","orderId","data.id","id"])) || null,
    status: "active", registered_at: new Date().toISOString(), expires_at: fallbackExpiry,
    auto_renew: true, privacy_enabled: true, locked: true, nameservers: order.nameservers,
    metadata: { registrationResponse: response }, next_sync_at: new Date().toISOString(),
  }, { onConflict: "domain_name" }).select("*").single();
  if (domainError) throw domainError;
  await db.from("domain_orders").update({
    domain_id: domain.id, status: "completed", completed_at: new Date().toISOString(),
    registrar_response: response, registrar_order_id: domain.registrar_order_id,
  }).eq("id", order.id);
  await db.rpc("domain_enqueue_job", {
    p_type: "sync_domain", p_idempotency_key: `sync:${domain.id}:${Date.now()}`,
    p_user_id: order.user_id, p_domain_id: domain.id, p_order_id: order.id, p_payload: {},
    p_run_after: new Date(Date.now() + 30_000).toISOString(),
  });
  await queueEmail({
    eventKey: `domain-ready:${order.id}`, recipientEmail: order.domain_users.email, recipientName: order.domain_users.full_name,
    template: "domain_ready", subject: `${order.domain_name} is ready`,
    payload: { name: order.domain_users.full_name, domainName: order.domain_name, orderNumber: order.order_number, expiresAt: fallbackExpiry },
    userId: order.user_id, orderId: order.id, domainId: domain.id,
  });
  await notify(order.user_id, "domain_ready", "Domain ready", `${order.domain_name} is active.`, { domainId: domain.id });
}

async function processTransfer(job: Json): Promise<void> {
  const { data: order, error } = await db.from("domain_orders").select("*,domain_contacts(*),domain_users(*)").eq("id", job.order_id).single();
  if (error || !order) throw new ApiError(404, "order_not_found", "Transfer order was not found.");
  if (order.status === "completed") return;
  const authCode = await decryptSensitive(order.auth_code_ciphertext);
  if (!authCode) throw new ApiError(400, "auth_code_missing", "Transfer authorization code is missing.");
  await db.from("domain_orders").update({ status: "processing" }).eq("id", order.id);
  const response = await transferDomain({ domainName: order.domain_name, period: Number(order.years), authCode, contact: order.domain_contacts });
  if (!registrarSuccess(response)) throw new ApiError(502, "transfer_failed", "Registrar did not accept the transfer.", response);
  const { data: domain, error: domainError } = await db.from("domain_domains").upsert({
    user_id: order.user_id, contact_id: order.contact_id, domain_name: order.domain_name, tld: order.tld,
    registrar_order_id: clean(pick(response, ["data.orderId","orderId","data.id","id"])) || null,
    status: "transfer_pending", auto_renew: true, nameservers: order.nameservers,
    metadata: { transferResponse: response }, next_sync_at: new Date(Date.now() + 300_000).toISOString(),
  }, { onConflict: "domain_name" }).select("*").single();
  if (domainError) throw domainError;
  await db.from("domain_orders").update({
    domain_id: domain.id, status: "completed", completed_at: new Date().toISOString(),
    registrar_response: response, auth_code_ciphertext: null,
  }).eq("id", order.id);
  await queueEmail({
    eventKey: `transfer-started:${order.id}`, recipientEmail: order.domain_users.email, recipientName: order.domain_users.full_name,
    template: "transfer_started", subject: `Transfer started — ${order.domain_name}`,
    payload: { name: order.domain_users.full_name, domainName: order.domain_name, orderNumber: order.order_number },
    userId: order.user_id, orderId: order.id, domainId: domain.id,
  });
}

async function processRenew(job: Json): Promise<void> {
  const { data: order, error } = await db.from("domain_orders").select("*,domain_domains(*),domain_users(*)").eq("id", job.order_id).single();
  if (error || !order) throw new ApiError(404, "order_not_found", "Renewal order was not found.");
  if (order.status === "completed") return;
  const domain = order.domain_domains;
  if (!domain) throw new ApiError(404, "domain_not_found", "Renewal target was not found.");
  await db.from("domain_orders").update({ status: "processing" }).eq("id", order.id);
  const response = await renewDomain(order.domain_name, Number(order.years));
  if (!registrarSuccess(response)) throw new ApiError(502, "renewal_failed", "Registrar did not confirm renewal.", response);
  const base = domain.expires_at && new Date(domain.expires_at).getTime() > Date.now() ? new Date(domain.expires_at) : new Date();
  const fallbackExpiry = addYears(base, Number(order.years)).toISOString();
  await db.from("domain_domains").update({
    status: "active", expires_at: fallbackExpiry, last_reminder_days: null, next_sync_at: new Date().toISOString(),
    metadata: { ...(domain.metadata || {}), lastRenewalResponse: response },
  }).eq("id", domain.id);
  await db.from("domain_orders").update({
    status: "completed", completed_at: new Date().toISOString(), registrar_response: response,
  }).eq("id", order.id);
  await queueEmail({
    eventKey: `domain-ready:${order.id}`, recipientEmail: order.domain_users.email, recipientName: order.domain_users.full_name,
    template: "domain_ready", subject: `${order.domain_name} renewal completed`,
    payload: { name: order.domain_users.full_name, domainName: order.domain_name, orderNumber: order.order_number, expiresAt: fallbackExpiry },
    userId: order.user_id, orderId: order.id, domainId: domain.id,
  });
  await notify(order.user_id, "renewal_completed", "Renewal completed", `${order.domain_name} was renewed successfully.`, { domainId: domain.id });
}

async function processSync(job: Json): Promise<void> {
  const { data: domain, error } = await db.from("domain_domains").select("*").eq("id", job.domain_id).single();
  if (error || !domain) return;
  const response = await domainInfo(domain.domain_name);
  const fields = infoFields(response);
  await db.from("domain_domains").update({
    status: fields.status, expires_at: fields.expiresAt || domain.expires_at,
    registered_at: fields.registeredAt || domain.registered_at,
    nameservers: fields.nameServers.length ? fields.nameServers : domain.nameservers,
    registrar_domain_id: fields.registrarId || domain.registrar_domain_id,
    epp_statuses: fields.epp, last_synced_at: new Date().toISOString(),
    next_sync_at: new Date(Date.now() + (fields.status === "transfer_pending" ? 3_600_000 : 21_600_000)).toISOString(),
    metadata: { ...(domain.metadata || {}), lastInfoResponse: response },
  }).eq("id", domain.id);
}

async function processNameservers(job: Json): Promise<void> {
  const { data: domain, error } = await db.from("domain_domains").select("*").eq("id", job.domain_id).single();
  if (error || !domain) throw new ApiError(404, "domain_not_found", "Domain was not found.");
  const nameServers = Array.isArray(job.payload?.nameServers) ? job.payload.nameServers.map(clean).filter(Boolean) : [];
  if (nameServers.length < 2) throw new ApiError(400, "invalid_nameservers", "At least two nameservers are required.");
  const response = await updateNameServers(domain.domain_name, nameServers);
  await db.from("domain_domains").update({ nameservers: nameServers, metadata: { ...(domain.metadata || {}), nameserverResponse: response } }).eq("id", domain.id);
}

async function processDns(job: Json): Promise<void> {
  const { data: record, error } = await db.from("domain_dns_records").select("*,domain_domains(*)").eq("id", job.payload?.recordId).single();
  if (error || !record) {
    if (job.type === "delete_dns_record") return;
    throw new ApiError(404, "dns_record_not_found", "DNS record was not found.");
  }
  const domain = record.domain_domains;
  let response: Json = {};
  if (job.type === "create_dns_record") {
    response = await createZoneRecord(domain.domain_name, record);
    await db.from("domain_dns_records").update({ status: "active", registrar_response: response }).eq("id", record.id);
  } else if (job.type === "update_dns_record") {
    response = await updateZoneRecord(domain.domain_name, clean(job.payload?.oldName || record.name), record);
    await db.from("domain_dns_records").update({ status: "active", registrar_response: response }).eq("id", record.id);
  } else {
    response = await deleteZoneRecord(domain.domain_name, record);
    await db.from("domain_dns_records").delete().eq("id", record.id);
  }
}

async function processPaymentCheck(job: Json): Promise<void> {
  const paymentId = clean(job.payload?.paymentId);
  const { data: payment, error } = await db.from("domain_payments").select("*").eq("id", paymentId).single();
  if (error || !payment || payment.status === "paid" || !payment.provider_reference) return;
  const payload = await camerPayStatus(payment.provider_reference);
  await db.from("domain_payments").update({ raw_payload: payload }).eq("id", payment.id);
  await markPaymentPaid(payment, payload);
}

async function processJob(job: Json): Promise<void> {
  if (job.type === "register_domain") return await processRegister(job);
  if (job.type === "transfer_domain") return await processTransfer(job);
  if (job.type === "renew_domain") return await processRenew(job);
  if (job.type === "sync_domain") return await processSync(job);
  if (job.type === "update_nameservers") return await processNameservers(job);
  if (["create_dns_record","update_dns_record","delete_dns_record"].includes(job.type)) return await processDns(job);
  if (job.type === "check_payment") return await processPaymentCheck(job);
  if (["cleanup","auto_renew","send_email","restore_domain"].includes(job.type)) return;
  throw new ApiError(400, "unknown_job", `Unknown job type: ${job.type}`);
}

export async function runJobs(workerId: string, limit = 15): Promise<{ completed: number; failed: number }> {
  const { data: jobs, error } = await db.rpc("domain_claim_jobs", { p_worker: workerId, p_limit: limit });
  if (error) throw error;
  let completed = 0, failed = 0;
  for (const job of jobs || []) {
    try {
      await processJob(job);
      await db.from("domain_jobs").update({
        status: "completed", completed_at: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null,
      }).eq("id", job.id);
      completed++;
    } catch (error) {
      const dead = Number(job.attempts) >= Number(job.max_attempts);
      const delayMinutes = Math.min(360, Math.pow(2, Math.max(0, Number(job.attempts) - 1)));
      await db.from("domain_jobs").update({
        status: dead ? "dead" : "failed", run_after: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        locked_at: null, locked_by: null, last_error: errorMessage(error).slice(0, 2000),
      }).eq("id", job.id);
      if (job.order_id && dead) {
        const { data: order } = await db.from("domain_orders").select("*,domain_users(*)").eq("id", job.order_id).maybeSingle();
        if (order) {
          await db.from("domain_orders").update({ status: "failed", failure_message: errorMessage(error) }).eq("id", order.id);
          await queueEmail({
            eventKey: `domain-failed:${order.id}`, recipientEmail: order.domain_users.email, recipientName: order.domain_users.full_name,
            template: "domain_failed", subject: `Action required — ${order.domain_name}`,
            payload: { name: order.domain_users.full_name, domainName: order.domain_name, orderNumber: order.order_number, message: errorMessage(error) },
            userId: order.user_id, orderId: order.id, domainId: order.domain_id,
          });
        }
      }
      failed++;
    }
  }
  return { completed, failed };
}

export async function runEmails(limit = 20): Promise<{ sent: number; failed: number }> {
  const { data: messages, error } = await db.rpc("domain_claim_emails", { p_limit: limit });
  if (error) throw error;
  let sent = 0, failed = 0;
  for (const message of messages || []) {
    try {
      const rendered = await renderEmail(message.template, message.payload || {});
      const providerId = await sendMail({
        email: message.recipient_email, name: message.recipient_name, subject: message.subject || rendered.subject || "KmerHosting Domains",
        text: rendered.text, html: rendered.html, category: rendered.category,
      });
      await db.from("domain_email_outbox").update({
        status: "sent", sent_at: new Date().toISOString(), provider_message_id: providerId, last_error: null,
      }).eq("id", message.id);
      sent++;
    } catch (error) {
      const dead = Number(message.attempts) >= 8;
      const delayMinutes = Math.min(360, Math.pow(2, Math.max(0, Number(message.attempts) - 1)));
      await db.from("domain_email_outbox").update({
        status: dead ? "dead" : "failed", next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        last_error: errorMessage(error).slice(0, 2000),
      }).eq("id", message.id);
      failed++;
    }
  }
  return { sent, failed };
}

async function ensureRenewalOrder(domain: Json): Promise<void> {
  const { data: active } = await db.from("domain_orders").select("id").eq("domain_id", domain.id).eq("type", "renewal")
    .in("status", ["pending_payment","payment_pending","paid","queued","processing"]).limit(1);
  if (active?.length) return;
  const cfg = await getConfig();
  const { data: price } = await db.from("domain_tld_prices").select("*").eq("tld", domain.tld).single();
  const { data: user } = await db.from("domain_users").select("*").eq("id", domain.user_id).single();
  const { data: contact } = await db.from("domain_contacts").select("*").eq("id", domain.contact_id).maybeSingle();
  if (!price || !user) return;
  const priceUsd = Number(price.renewal_price_usd);
  const amountXaf = Math.ceil(priceUsd * cfg.usd_to_xaf_rate);
  const { data: order, error } = await db.from("domain_orders").insert({
    order_number: randomReference("KHD-REN"), idempotency_key: `auto-renew:${domain.id}:${domain.expires_at}`,
    user_id: domain.user_id, contact_id: domain.contact_id, domain_id: domain.id, type: "renewal",
    domain_name: domain.domain_name, tld: domain.tld, years: 1, status: "pending_payment",
    price_usd: priceUsd, usd_to_xaf_rate: cfg.usd_to_xaf_rate, amount_xaf: amountXaf,
    nameservers: domain.nameservers || [], contact_snapshot: contact || {},
  }).select("*").single();
  if (error || !order) return;
  await notify(user.id, "renewal_payment_required", "Renewal payment required", `A renewal order was prepared for ${domain.domain_name}.`, { orderId: order.id, domainId: domain.id });
}

export async function lifecycleSweep(): Promise<Json> {
  const cfg = await getConfig();
  const now = new Date();
  const horizon = new Date(now.getTime() + 61 * 86_400_000).toISOString();
  const { data: domains } = await db.from("domain_domains")
    .select("*,domain_users(*),domain_contacts(*)").in("status", ["active","transfer_pending","expired","grace"]).lte("expires_at", horizon);
  let reminders = 0, renewalOrders = 0;
  for (const domain of domains || []) {
    if (!domain.expires_at) continue;
    const days = Math.ceil((new Date(domain.expires_at).getTime() - now.getTime()) / 86_400_000);
    const notice = cfg.renewal_notice_days.find((n) => days <= n && days > n - 1);
    if (notice !== undefined && Number(domain.last_reminder_days) !== notice) {
      await queueEmail({
        eventKey: `renewal-reminder:${domain.id}:${notice}:${String(domain.expires_at).slice(0,10)}`,
        recipientEmail: domain.domain_users.email, recipientName: domain.domain_users.full_name,
        template: "renewal_reminder", subject: `${domain.domain_name} expires in ${notice} day${notice === 1 ? "" : "s"}`,
        payload: { name: domain.domain_users.full_name, domainName: domain.domain_name, expiresAt: domain.expires_at, days: notice, autoRenew: domain.auto_renew },
        userId: domain.user_id, domainId: domain.id,
      });
      await db.from("domain_domains").update({ last_reminder_days: notice }).eq("id", domain.id);
      reminders++;
    }
    if (domain.auto_renew && days <= cfg.auto_renew_charge_days && days >= 0) {
      const before = await db.from("domain_orders").select("id").eq("domain_id", domain.id).eq("type","renewal")
        .in("status", ["pending_payment","payment_pending","paid","queued","processing"]).limit(1);
      if (!before.data?.length) { await ensureRenewalOrder(domain); renewalOrders++; }
    }
    if (days < 0 && domain.status === "active") {
      await db.from("domain_domains").update({ status: "expired" }).eq("id", domain.id);
    }
  }
  const { data: dueSync } = await db.from("domain_domains").select("id,user_id").lte("next_sync_at", now.toISOString()).neq("status","cancelled").limit(100);
  for (const domain of dueSync || []) {
    await db.rpc("domain_enqueue_job", {
      p_type: "sync_domain", p_idempotency_key: `sync:${domain.id}:${Math.floor(Date.now()/21_600_000)}`,
      p_user_id: domain.user_id, p_domain_id: domain.id, p_payload: {},
    });
  }
  await db.from("domain_sessions").delete().lt("expires_at", now.toISOString());
  await db.from("domain_otp_challenges").delete().lt("expires_at", new Date(now.getTime() - 86_400_000).toISOString());
  await db.from("domain_rate_limits").delete().lt("updated_at", new Date(now.getTime() - 7 * 86_400_000).toISOString());
  return { reminders, renewalOrders, syncQueued: dueSync?.length || 0 };
}

export async function runAutomation(): Promise<Json> {
  const lifecycle = await lifecycleSweep();
  const jobs = await runJobs(`cron-${crypto.randomUUID()}`, 20);
  const emails = await runEmails(30);
  return { lifecycle, jobs, emails, at: new Date().toISOString() };
}
