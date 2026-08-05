import { FormEvent, useEffect, useMemo, useState } from "react";
import { dnsToolsApi, formatDate } from "./api";

type Row = Record<string, any>;
type DnsState = { domain: Row; records: Row[]; dns: { currentNameservers: string[]; managedNameservers: string[]; dnsManagedActive: boolean; warning?: string | null }; currentEnvironment: string };

function domainIdFromPath() {
  return window.location.pathname.match(/^\/dashboard\/domains\/([0-9a-f-]+)\/dns$/i)?.[1] || "";
}

export function isDnsSettingsPage(pathname = window.location.pathname) {
  return /^\/dashboard\/domains\/[0-9a-f-]+\/dns$/i.test(pathname);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

function Badge({ value }: { value?: string | null }) {
  const v = String(value || "unknown");
  return <span className={`status status-${v.toLowerCase().replaceAll("_", "-")}`}>{v.replaceAll("_", " ")}</span>;
}

function EnvBadge({ env }: { env?: string | null }) {
  const test = String(env || "production").toLowerCase() === "ote";
  return <span className={test ? "khd-env-badge" : "khd-env-badge khd-env-badge-live"}>{test ? "TEST / OTE" : "LIVE"}</span>;
}

function emptyForm() {
  return { name: "@", type: "A", content: "", ttl: 3600, priority: "", weight: "", port: "", target: "", flag: 0, tag: "issue", value: "" } as Row;
}

function formFromRecord(r: Row) {
  return {
    name: r.name || "@",
    type: r.type || "A",
    content: Array.isArray(r.contents) ? r.contents.join(", ") : "",
    ttl: r.ttl || 3600,
    priority: r.priority ?? "",
    weight: r.metadata?.weight ?? "",
    port: r.metadata?.port ?? "",
    target: r.metadata?.target ?? r.contents?.[0] ?? "",
    flag: r.metadata?.flag ?? 0,
    tag: r.metadata?.tag ?? "issue",
    value: r.metadata?.value ?? r.contents?.[0] ?? "",
  } as Row;
}

function payloadFromForm(form: Row) {
  const type = String(form.type || "A").toUpperCase();
  const payload: Row = { name: form.name || "@", type, ttl: Number(form.ttl || 3600) };
  if (type === "MX") {
    payload.priority = Number(form.priority);
    payload.content = form.content;
  } else if (type === "SRV") {
    payload.priority = Number(form.priority);
    payload.weight = Number(form.weight);
    payload.port = Number(form.port);
    payload.target = form.target || form.content;
  } else if (type === "CAA") {
    payload.flag = Number(form.flag || 0);
    payload.tag = form.tag || "issue";
    payload.value = form.value || form.content;
  } else {
    payload.contents = String(form.content || "").split(/[\n,]+/).map((v) => v.trim()).filter(Boolean);
  }
  return payload;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label>{label}{children}</label>;
}

function RecordForm({ form, setForm, editId, onSubmit, onCancel, busy }: { form: Row; setForm: (v: Row) => void; editId: string | null; onSubmit: (e: FormEvent<HTMLFormElement>) => void; onCancel: () => void; busy: boolean }) {
  const type = String(form.type || "A").toUpperCase();
  const set = (key: string, value: unknown) => setForm({ ...form, [key]: value });
  return <form className="form-stack" onSubmit={onSubmit}>
    <div className="form-row">
      <Field label="Name"><input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="@, www, mail" required /></Field>
      <Field label="Type"><select value={type} onChange={(e) => setForm({ ...emptyForm(), name: form.name || "@", type: e.target.value })}>{["A","AAAA","CNAME","MX","TXT","NS","SRV","CAA"].map((t) => <option key={t}>{t}</option>)}</select></Field>
      <Field label="TTL"><input type="number" min="60" max="86400" value={form.ttl} onChange={(e) => set("ttl", e.target.value)} required /></Field>
    </div>
    {type === "MX" && <div className="form-row"><Field label="Priority"><input type="number" min="0" max="65535" value={form.priority} onChange={(e) => set("priority", e.target.value)} required /></Field><Field label="Mail server"><input value={form.content} onChange={(e) => set("content", e.target.value)} placeholder="mail.example.com" required /></Field></div>}
    {type === "SRV" && <><div className="form-row"><Field label="Priority"><input type="number" min="0" max="65535" value={form.priority} onChange={(e) => set("priority", e.target.value)} required /></Field><Field label="Weight"><input type="number" min="0" max="65535" value={form.weight} onChange={(e) => set("weight", e.target.value)} required /></Field><Field label="Port"><input type="number" min="1" max="65535" value={form.port} onChange={(e) => set("port", e.target.value)} required /></Field></div><Field label="Target"><input value={form.target} onChange={(e) => set("target", e.target.value)} placeholder="server.example.com" required /></Field></>}
    {type === "CAA" && <div className="form-row"><Field label="Flag"><input type="number" min="0" max="255" value={form.flag} onChange={(e) => set("flag", e.target.value)} required /></Field><Field label="Tag"><select value={form.tag} onChange={(e) => set("tag", e.target.value)}>{["issue","issuewild","iodef","contactemail","contactphone","accounturi"].map((t) => <option key={t}>{t}</option>)}</select></Field><Field label="Value"><input value={form.value} onChange={(e) => set("value", e.target.value)} placeholder="letsencrypt.org" required /></Field></div>}
    {!["MX","SRV","CAA"].includes(type) && <Field label={type === "TXT" ? "Value" : "Value(s)"}><textarea value={form.content} onChange={(e) => set("content", e.target.value)} placeholder={type === "A" ? "192.0.2.10" : type === "CNAME" ? "target.example.com" : "one value per line or comma separated"} required /></Field>}
    <div className="heading-actions"><button className="button button-primary" disabled={busy}>{editId ? "Save DNS record" : "Add DNS record"}</button>{editId && <button type="button" className="button button-secondary" onClick={onCancel}>Cancel edit</button>}</div>
  </form>;
}

export function DnsSettingsPage() {
  const domainId = useMemo(domainIdFromPath, []);
  const [data, setData] = useState<DnsState | null>(null);
  const [form, setForm] = useState<Row>(emptyForm());
  const [editId, setEditId] = useState<string | null>(null);
  const [nameservers, setNameservers] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    const next = await dnsToolsApi<DnsState>(`/domains/${domainId}/dns`);
    setData(next);
    setNameservers(next.domain.nameservers?.length ? next.domain.nameservers : next.dns.managedNameservers);
  };
  useEffect(() => { load().catch((e) => setError(errorText(e))); }, [domainId]);
  const submitRecord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy("record"); setError(null);
    try {
      const payload = payloadFromForm(form);
      if (editId) await dnsToolsApi(`/domains/${domainId}/dns/${editId}`, { method: "PUT", body: payload });
      else await dnsToolsApi(`/domains/${domainId}/dns`, { method: "POST", body: payload });
      setEditId(null); setForm(emptyForm()); await load();
    } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  const action = async (name: string, run: () => Promise<unknown>) => { setBusy(name); setError(null); try { await run(); await load(); } catch (e) { setError(errorText(e)); } finally { setBusy(null); } };
  const saveNameservers = async () => action("nameservers", () => dnsToolsApi(`/domains/${domainId}/nameservers`, { method: "PUT", body: { nameServers: nameservers.filter(Boolean) } }));
  const sync = async () => action("sync", () => dnsToolsApi(`/domains/${domainId}/dns/sync`, { method: "POST" }));
  const readonly = data?.domain?.registrar_environment && data.domain.registrar_environment !== data.currentEnvironment;
  return <main className="dashboard-main native-page-main"><div className="dashboard-content"><div className="page-heading"><div><a className="back-link" href={`/dashboard/domains/${domainId}`}>← Domain</a><div className="title-with-status"><h1>DNS settings</h1>{data?.domain && <EnvBadge env={data.domain.registrar_environment} />}</div><p>{data?.domain?.domain_name || "Domain DNS management"}</p></div><div className="heading-actions"><button className="button button-secondary" onClick={sync} disabled={Boolean(busy || readonly)}>Sync from provider</button><button className="button button-secondary" onClick={() => load().catch((e) => setError(errorText(e)))}>Refresh</button></div></div>
    <style>{`.dns-settings-grid{display:grid;gap:20px}.dns-tools-row{display:flex;gap:8px;flex-wrap:wrap}.dns-value{max-width:420px;overflow:hidden;text-overflow:ellipsis}.dns-meta{display:block;color:#64748b;font-size:12px}.native-page-main textarea{min-height:84px}.khd-env-badge{display:inline-flex;align-items:center;margin-left:8px;padding:3px 8px;border-radius:999px;border:1px solid #fed7aa;background:#fff7ed;color:#9a3412;font-size:11px;font-weight:900;text-transform:uppercase}.khd-env-badge-live{border-color:#bbf7d0;background:#f0fdf4;color:#166534}`}</style>
    {error && <div className="alert alert-error">{error}</div>}
    {!data ? <div className="loading">Loading DNS settings…</div> : <div className="dns-settings-grid">
      {readonly && <div className="alert alert-warning"><strong>TEST / OTE domain.</strong> This domain belongs to {data.domain.registrar_environment}. Current platform environment is {data.currentEnvironment}. Provider actions are blocked.</div>}
      {data.dns.warning && <div className="alert alert-warning"><strong>DNS provider warning.</strong> {data.dns.warning}</div>}
      <section className="card"><div className="card-heading"><div><h2>Nameservers</h2><p>Use 2 to 13 nameservers. DNS records below are publicly active only when the managed nameservers are used.</p></div><Badge value={data.dns.dnsManagedActive ? "managed_dns_active" : "external_dns"} /></div>
        <div className="form-stack">{nameservers.map((ns, i) => <div className="dns-add-row" key={i}><input value={ns} onChange={(e) => setNameservers(nameservers.map((v, idx) => idx === i ? e.target.value : v))} placeholder={`ns${i + 1}.example.com`} /><button className="button button-secondary" disabled={nameservers.length <= 2} onClick={() => setNameservers(nameservers.filter((_, idx) => idx !== i))}>Remove</button></div>)}<div className="dns-tools-row"><button className="button button-secondary" disabled={nameservers.length >= 13} onClick={() => setNameservers([...nameservers, ""])}>Add nameserver</button><button className="button button-primary" disabled={Boolean(busy || readonly)} onClick={saveNameservers}>Save nameservers</button></div></div>
        <p className="dns-meta">Managed nameservers: {(data.dns.managedNameservers || []).join(", ") || "not configured"}</p></section>
      <section className="card"><div className="card-heading"><div><h2>{editId ? "Edit DNS record" : "Add DNS record"}</h2><p>Validation is enforced by record type before the provider operation is sent.</p></div></div><RecordForm form={form} setForm={setForm} editId={editId} busy={busy === "record" || Boolean(readonly)} onSubmit={submitRecord} onCancel={() => { setEditId(null); setForm(emptyForm()); }} /></section>
      <section className="card"><div className="card-heading"><div><h2>DNS records</h2><p>Provider-synced records with edit, delete and retry controls.</p></div><button className="button button-secondary" onClick={sync} disabled={Boolean(busy || readonly)}>Sync from DomainNameAPI</button></div>
        {data.records.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Value</th><th>TTL</th><th>Status</th><th>Source</th><th>Last sync</th><th>Actions</th></tr></thead><tbody>{data.records.map((r) => <tr key={r.id}><td>{r.name}</td><td><span className="record-type">{r.type}</span>{r.priority !== null && r.priority !== undefined && <small className="dns-meta">prio {r.priority}</small>}</td><td className="mono dns-value">{Array.isArray(r.contents) ? r.contents.join(", ") : "—"}{r.metadata?.weight !== undefined && <small className="dns-meta">weight {r.metadata.weight} · port {r.metadata.port}</small>}{r.metadata?.tag && <small className="dns-meta">CAA {r.metadata.flag} {r.metadata.tag}</small>}{r.last_error && <small className="dns-meta">Error: {r.last_error}</small>}</td><td>{r.ttl}</td><td><Badge value={r.status} /></td><td>{r.source || "local"}</td><td>{formatDate(r.synced_at || r.updated_at)}</td><td><div className="dns-tools-row"><button className="button button-secondary" onClick={() => { setEditId(r.id); setForm(formFromRecord(r)); }}>Edit</button><button className="button button-secondary" disabled={Boolean(busy || readonly)} onClick={() => action(`retry-${r.id}`, () => dnsToolsApi(`/domains/${domainId}/dns/${r.id}/retry`, { method: "POST" }))}>Retry</button><button className="button button-secondary" disabled={Boolean(busy || readonly)} onClick={() => confirm(`Delete ${r.type} ${r.name}?`) && action(`delete-${r.id}`, () => dnsToolsApi(`/domains/${domainId}/dns/${r.id}`, { method: "DELETE" }))}>Delete</button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>No DNS records locally</h3><p>Use Sync from DomainNameAPI to import provider records, or add a new record.</p></div>}
      </section>
    </div>}
  </div></main>;
}
