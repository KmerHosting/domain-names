import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { dnsToolsApi, formatDate } from "./api";

type Row = Record<string, any>;
type DnsState = {
  domain: { id: string; domainName: string; nameservers: string[]; environment: "production" | "ote" };
  records: Row[];
  synced: boolean;
  providerError?: string | null;
  managedDns: boolean;
  warning?: string | null;
};
type RecordFormState = {
  name: string;
  type: string;
  value: string;
  ttl: string;
  priority: string;
  weight: string;
  port: string;
  target: string;
  flag: string;
  tag: string;
};

function domainIdFromPath() {
  return window.location.pathname.match(/^\/dashboard\/domains\/([0-9a-f-]+)\/dns$/i)?.[1] || "";
}

export function isDnsSettingsPage(pathname = window.location.pathname) {
  return /^\/dashboard\/domains\/[0-9a-f-]+\/dns$/i.test(pathname);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

function emptyRecord(): RecordFormState {
  return { name: "@", type: "A", value: "", ttl: "3600", priority: "10", weight: "0", port: "", target: "", flag: "0", tag: "issue" };
}

function Badge({ value }: { value?: string | null }) {
  const text = String(value || "unknown");
  return <span className={`status status-${text.toLowerCase().replaceAll("_", "-")}`}>{text.replaceAll("_", " ")}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label>{label}{children}</label>;
}

function payload(form: RecordFormState): Row {
  const type = form.type.toUpperCase();
  const base: Row = { name: form.name.trim() || "@", type, ttl: Number(form.ttl || 3600) };
  if (type === "MX") return { ...base, priority: Number(form.priority), target: form.target.trim() || form.value.trim() };
  if (type === "SRV") return { ...base, priority: Number(form.priority), weight: Number(form.weight), port: Number(form.port), target: form.target.trim() };
  if (type === "CAA") return { ...base, flag: Number(form.flag), tag: form.tag, caaValue: form.value.trim() };
  return { ...base, contents: form.value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean) };
}

function formFromRecord(record: Row): RecordFormState {
  const content = Array.isArray(record.contents) ? record.contents.join("\n") : "";
  return {
    name: record.name || "@",
    type: record.type || "A",
    value: content,
    ttl: String(record.ttl || 3600),
    priority: String(record.priority ?? 10),
    weight: "0",
    port: "",
    target: "",
    flag: "0",
    tag: "issue",
  };
}

export function DnsSettingsPage() {
  const domainId = useMemo(domainIdFromPath, []);
  const [state, setState] = useState<DnsState | null>(null);
  const [record, setRecord] = useState<RecordFormState>(emptyRecord());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameservers, setNameservers] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const next = await dnsToolsApi<DnsState>(`/domains/${domainId}/records`);
    setState(next);
    setNameservers(next.domain.nameservers?.length ? next.domain.nameservers : ["", ""]);
  };

  useEffect(() => {
    load().catch((caught) => setError(errorText(caught)));
  }, [domainId]);

  const run = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  const submitRecord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await run("record", async () => {
      if (editingId) {
        await dnsToolsApi(`/domains/${domainId}/records/${editingId}`, { method: "PUT", body: payload(record) });
      } else {
        await dnsToolsApi(`/domains/${domainId}/records`, { method: "POST", body: payload(record) });
      }
      setEditingId(null);
      setRecord(emptyRecord());
    });
  };

  const type = record.type.toUpperCase();
  const env = state?.domain.environment || "production";

  return <main className="dashboard-main native-page-main"><div className="dashboard-content">
    <div className="page-heading">
      <div>
        <a className="back-link" href={`/dashboard/domains/${domainId}`}>← Domain</a>
        <div className="title-with-status"><h1>DNS settings</h1><span className={env === "ote" ? "status status-pending" : "status status-active"}>{env === "ote" ? "TEST / OTE" : "LIVE"}</span></div>
        <p>{state?.domain.domainName || "Domain DNS management"}</p>
      </div>
      <div className="heading-actions">
        <button className="button button-secondary" disabled={Boolean(busy)} onClick={() => run("sync", () => dnsToolsApi(`/domains/${domainId}/sync`, { method: "POST" }))}>Sync from provider</button>
        <button className="button button-secondary" disabled={Boolean(busy)} onClick={() => load().catch((caught) => setError(errorText(caught)))}>Refresh</button>
      </div>
    </div>

    {env === "ote" && <div className="alert alert-warning"><strong>Test domain.</strong> DNS changes are sent only to DomainNameAPI OTE and cannot affect the production registrar balance.</div>}
    {state?.providerError && <div className="alert alert-warning"><strong>Provider sync failed.</strong> {state.providerError}. Local records remain visible and were not deleted.</div>}
    {state?.warning && <div className="alert alert-warning"><strong>Nameserver warning.</strong> {state.warning}</div>}
    {error && <div className="alert alert-error">{error}</div>}

    {!state ? <div className="loading">Loading DNS settings…</div> : <div className="dns-settings-grid">
      <section className="card">
        <div className="card-heading"><div><h2>Nameservers</h2><p>DomainNameAPI accepts between 2 and 13 nameservers.</p></div><Badge value={state.managedDns ? "managed_dns_active" : "external_dns"} /></div>
        <div className="form-stack">
          {nameservers.map((value, index) => <div className="dns-add-row" key={index}>
            <input value={value} onChange={(event) => setNameservers(nameservers.map((item, position) => position === index ? event.target.value : item))} placeholder={`ns${index + 1}.example.com`} />
            <button type="button" className="button button-secondary" disabled={nameservers.length <= 2} onClick={() => setNameservers(nameservers.filter((_, position) => position !== index))}>Remove</button>
          </div>)}
          <div className="heading-actions">
            <button type="button" className="button button-secondary" disabled={nameservers.length >= 13} onClick={() => setNameservers([...nameservers, ""])}>Add nameserver</button>
            <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => run("nameservers", () => dnsToolsApi(`/domains/${domainId}/nameservers`, { method: "PUT", body: { nameServers: nameservers.filter(Boolean) } }))}>Save nameservers</button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-heading"><div><h2>{editingId ? "Edit DNS record" : "Add DNS record"}</h2><p>Records are validated locally, sent to DomainNameAPI, then applied to the zone.</p></div></div>
        <form className="form-stack" onSubmit={submitRecord}>
          <div className="form-row">
            <Field label="Name"><input value={record.name} onChange={(event) => setRecord({ ...record, name: event.target.value })} required /></Field>
            <Field label="Type"><select value={type} onChange={(event) => setRecord({ ...emptyRecord(), name: record.name, type: event.target.value })}>{["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"].map((item) => <option key={item}>{item}</option>)}</select></Field>
            <Field label="TTL"><input type="number" min="1" max="86400" value={record.ttl} onChange={(event) => setRecord({ ...record, ttl: event.target.value })} required /></Field>
          </div>
          {type === "MX" && <div className="form-row"><Field label="Priority"><input type="number" min="0" max="65535" value={record.priority} onChange={(event) => setRecord({ ...record, priority: event.target.value })} /></Field><Field label="Mail server"><input value={record.target} onChange={(event) => setRecord({ ...record, target: event.target.value })} required /></Field></div>}
          {type === "SRV" && <><div className="form-row"><Field label="Priority"><input type="number" value={record.priority} onChange={(event) => setRecord({ ...record, priority: event.target.value })} /></Field><Field label="Weight"><input type="number" value={record.weight} onChange={(event) => setRecord({ ...record, weight: event.target.value })} /></Field><Field label="Port"><input type="number" min="1" max="65535" value={record.port} onChange={(event) => setRecord({ ...record, port: event.target.value })} required /></Field></div><Field label="Target"><input value={record.target} onChange={(event) => setRecord({ ...record, target: event.target.value })} required /></Field></>}
          {type === "CAA" && <div className="form-row"><Field label="Flag"><input type="number" min="0" max="255" value={record.flag} onChange={(event) => setRecord({ ...record, flag: event.target.value })} /></Field><Field label="Tag"><select value={record.tag} onChange={(event) => setRecord({ ...record, tag: event.target.value })}><option>issue</option><option>issuewild</option><option>iodef</option></select></Field><Field label="Value"><input value={record.value} onChange={(event) => setRecord({ ...record, value: event.target.value })} required /></Field></div>}
          {!['MX', 'SRV', 'CAA'].includes(type) && <Field label={type === "TXT" ? "Value" : "Value(s)"}><textarea value={record.value} onChange={(event) => setRecord({ ...record, value: event.target.value })} placeholder="One value per line or comma separated" required /></Field>}
          <div className="heading-actions"><button className="button button-primary" disabled={busy === "record"}>{editingId ? "Save record" : "Add record"}</button>{editingId && <button type="button" className="button button-secondary" onClick={() => { setEditingId(null); setRecord(emptyRecord()); }}>Cancel</button>}</div>
        </form>
      </section>

      <section className="card">
        <div className="card-heading"><div><h2>DNS records</h2><p>{state.records.length} record(s) stored after provider synchronization.</p></div></div>
        {state.records.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Value</th><th>TTL</th><th>Status</th><th>Source</th><th>Synced</th><th>Actions</th></tr></thead><tbody>{state.records.map((item) => <tr key={item.id}>
          <td>{item.name}</td><td><span className="record-type">{item.type}</span></td><td className="mono">{Array.isArray(item.contents) ? item.contents.join(", ") : "—"}</td><td>{item.ttl}</td><td><Badge value={item.status} /></td><td>{item.source || "local"}</td><td>{formatDate(item.synced_at || item.updated_at)}</td>
          <td><div className="heading-actions"><button className="button button-secondary" onClick={() => { setEditingId(item.id); setRecord(formFromRecord(item)); }}>Edit</button><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => run(`retry-${item.id}`, () => dnsToolsApi(`/domains/${domainId}/records/${item.id}`, { method: "PUT", body: payload(formFromRecord(item)) }))}>Retry</button><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => window.confirm(`Delete ${item.type} ${item.name}?`) && run(`delete-${item.id}`, () => dnsToolsApi(`/domains/${domainId}/records/${item.id}`, { method: "DELETE" }))}>Delete</button></div></td>
        </tr>)}</tbody></table></div> : <div className="empty-state"><h3>No DNS records</h3><p>Add a record or retry provider synchronization.</p></div>}
      </section>
    </div>}
  </div></main>;
}
