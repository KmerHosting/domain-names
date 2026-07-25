import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const encoder = new TextEncoder();

type Json = Record<string, any>;
class HttpError extends Error { status:number; code:string; details?:unknown; constructor(status:number, code:string, message:string, details?:unknown){ super(message); this.status=status; this.code=code; this.details=details; } }
const clean = (v: unknown) => String(v ?? "").trim();
const money = (v: unknown, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: currency === "XAF" ? 0 : 2 }).format(Number(v || 0));
const date = (v: unknown) => { const d = new Date(String(v || "")); return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(d); };
function cors(extra: HeadersInit = {}) { return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, content-type", "Access-Control-Allow-Methods":"GET,OPTIONS", "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", ...extra }; }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: cors({ "Content-Type":"application/json; charset=utf-8" }) }); }
async function sha256(value:string){ const d = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))); return Array.from(d).map((b)=>b.toString(16).padStart(2,"0")).join(""); }
function functionPath(req: Request) { const p = new URL(req.url).pathname; const marker = "/domain-documents"; const i = p.indexOf(marker); return (i >= 0 ? p.slice(i + marker.length) : p).replace(/\/+$/, "") || "/"; }
async function auth(req: Request) {
  const h = clean(req.headers.get("authorization"));
  if (!h.toLowerCase().startsWith("bearer ")) throw new HttpError(401, "authentication_required", "Sign in is required.");
  const tokenHash = await sha256(h.slice(7).trim());
  const { data: s, error } = await db.from("domain_sessions").select("*").eq("token_hash", tokenHash).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error || !s) throw new HttpError(401, "invalid_session", "Session expired or invalid.");
  const { data: u, error: ue } = await db.from("domain_users").select("*").eq("id", s.user_id).maybeSingle();
  if (ue || !u || u.status !== "active" || Number(u.session_version) !== Number(s.session_version)) throw new HttpError(401, "invalid_session", "Session expired or invalid.");
  return u as Json;
}
async function invoiceList(userId: string) {
  const { data, error } = await db.from("domain_billing_documents").select("*").eq("user_id", userId).order("issued_at", { ascending: false }).limit(100);
  if (error) throw error;
  return data || [];
}
async function loadByInvoice(userId: string, invoiceId: string) {
  const { data: invoice, error } = await db.from("domain_invoices").select("*").eq("id", invoiceId).eq("user_id", userId).maybeSingle();
  if (error || !invoice) throw new HttpError(404, "invoice_not_found", "Invoice not found.");
  return await loadBundle(userId, invoice.order_id, invoice);
}
async function loadByOrder(userId: string, orderId: string) { return await loadBundle(userId, orderId, null); }
async function loadBundle(userId: string, orderId: string, invoiceOverride: Json | null) {
  const [{ data: user }, { data: order }, { data: invoice }, { data: payment }] = await Promise.all([
    db.from("domain_users").select("*").eq("id", userId).single(),
    db.from("domain_orders").select("*").eq("id", orderId).eq("user_id", userId).single(),
    invoiceOverride ? Promise.resolve({ data: invoiceOverride } as any) : db.from("domain_invoices").select("*").eq("order_id", orderId).eq("user_id", userId).order("issued_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("domain_payments").select("*").eq("order_id", orderId).eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!user || !order) throw new HttpError(404, "document_not_found", "Billing document not found.");
  return { user: user as Json, order: order as Json, invoice: invoice as Json | null, payment: payment as Json | null };
}
function line(doc:any, label:string, value:unknown, x=54, y?:number){ if(y) doc.y = y; doc.font("Helvetica-Bold").fontSize(9).fillColor("#475467").text(label, x, doc.y, { continued:true, width:160 }); doc.font("Helvetica").fillColor("#172033").text(`  ${clean(value) || "—"}`); }
function addTable(doc:any, order:Json){
  const x=54, y=330; doc.moveTo(x,y).lineTo(540,y).strokeColor("#d8e0eb").stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#475467").text("Description", x, y+12).text("Years", 330, y+12).text("Amount", 430, y+12);
  doc.moveTo(x,y+32).lineTo(540,y+32).stroke();
  doc.font("Helvetica").fontSize(10).fillColor("#172033").text(`${String(order.type).replaceAll("_", " ")} — ${order.domain_name}`, x, y+48, { width:260 }).text(String(order.years || 1), 330, y+48).text(money(order.price_usd), 430, y+48);
  doc.moveTo(x,y+88).lineTo(540,y+88).stroke();
  doc.font("Helvetica-Bold").fontSize(11).text("Total USD", 330, y+106).text(money(order.price_usd), 430, y+106);
  doc.font("Helvetica").fontSize(9).fillColor("#667085").text(`Paid/charged in XAF: ${money(order.amount_xaf, "XAF")}`, 330, y+126, { width:200 });
}
async function pdfBuffer(kind:"invoice"|"receipt", bundle:{user:Json;order:Json;invoice:Json|null;payment:Json|null}){
  const chunks: Uint8Array[] = [];
  const doc:any = new PDFDocument({ size:"A4", margin:54, info:{ Title: kind === "invoice" ? "Invoice" : "Receipt", Author:"KmerHosting LLC" } });
  doc.on("data", (chunk:Uint8Array)=>chunks.push(new Uint8Array(chunk)));
  const done = new Promise<Uint8Array>((resolve)=>doc.on("end",()=>{ const size=chunks.reduce((s,c)=>s+c.length,0); const out=new Uint8Array(size); let o=0; for(const c of chunks){ out.set(c,o); o+=c.length; } resolve(out); }));
  const { user, order, invoice, payment } = bundle;
  doc.rect(0,0,612,120).fill("#0f172a");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(24).text("KmerHosting", 54, 42);
  doc.font("Helvetica").fontSize(10).text("KmerHosting LLC · Domain services", 54, 74);
  doc.font("Helvetica-Bold").fontSize(22).text(kind === "invoice" ? "INVOICE" : "PAYMENT RECEIPT", 390, 42, { align:"right", width:150 });
  doc.fillColor("#172033");
  const docNo = invoice?.invoice_number || `RECEIPT-${order.order_number}`;
  doc.font("Helvetica-Bold").fontSize(11).text(docNo, 390, 84, { align:"right", width:150 });
  doc.font("Helvetica-Bold").fontSize(11).text("Bill to", 54, 150);
  doc.font("Helvetica").fontSize(10).text(user.full_name || "Customer", 54, 170).text(user.email || "", 54, 186).text(user.phone || "", 54, 202);
  doc.font("Helvetica-Bold").fontSize(11).text("Document details", 330, 150);
  doc.font("Helvetica").fontSize(9);
  line(doc, "Order", order.order_number, 330, 170);
  line(doc, "Domain", order.domain_name, 330);
  line(doc, "Order status", order.status, 330);
  line(doc, "Payment status", payment?.status || invoice?.status || "—", 330);
  line(doc, "Issued", invoice?.issued_at ? date(invoice.issued_at) : date(order.created_at), 330);
  if(payment?.paid_at) line(doc, "Paid", date(payment.paid_at), 330);
  addTable(doc, order);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#172033").text("Payment", 54, 500);
  doc.font("Helvetica").fontSize(10).text(`Provider: ${payment?.provider || "wallet/direct"}`, 54, 522).text(`Method: ${payment?.payment_method || order.payment_method || "—"}`, 54, 538).text(`Reference: ${payment?.provider_reference || payment?.merchant_invoice_id || "—"}`, 54, 554);
  doc.fontSize(8).fillColor("#667085").text("This document was generated automatically by KmerHosting Domains. For support, contact support@kmerhosting.com.", 54, 735, { width:486, align:"center" });
  doc.end();
  return await done;
}
function pdfResponse(bytes:Uint8Array, filename:string){ return new Response(bytes, { status:200, headers: cors({ "Content-Type":"application/pdf", "Content-Disposition":`attachment; filename="${filename}"`, "Content-Length":String(bytes.length) }) }); }
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:cors() });
  try {
    const path = functionPath(req);
    if (req.method === "GET" && (path === "/" || path === "/health")) return json({ ok:true, service:"KmerHosting Domain Documents", pdf:"pdfkit", timestamp:new Date().toISOString() });
    const user = await auth(req);
    if (req.method === "GET" && path === "/invoices") return json({ invoices: await invoiceList(user.id) });
    const inv = path.match(/^\/invoices\/([0-9a-f-]+)\.pdf$/i);
    if (req.method === "GET" && inv) { const b = await loadByInvoice(user.id, inv[1]); return pdfResponse(await pdfBuffer("invoice", b), `${b.invoice?.invoice_number || "invoice"}.pdf`); }
    const rec = path.match(/^\/orders\/([0-9a-f-]+)\/receipt\.pdf$/i);
    if (req.method === "GET" && rec) { const b = await loadByOrder(user.id, rec[1]); return pdfResponse(await pdfBuffer("receipt", b), `${b.order.order_number}-receipt.pdf`); }
    return json({ error:"not_found", message:"Endpoint not found." }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error:e.code, message:e.message, details:e.details }, e.status);
    console.error(e); return json({ error:"internal_error", message:e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
