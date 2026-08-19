import {
  Button,
  Column,
  Grid,
  InlineLoading,
  InlineNotification,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextArea,
  TextInput,
  Tile,
} from "@carbon/react";
import { FormEvent, useEffect, useMemo, useState } from "react";
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

function tagType(value?: string | null): "green" | "red" | "warm-gray" | "blue" | "gray" {
  const text = String(value || "unknown").toLowerCase().replaceAll("_", "-");
  if (text.includes("active") || text.includes("synced") || text === "live") return "green";
  if (text.includes("failed") || text.includes("error")) return "red";
  if (text.includes("pending") || text.includes("retry")) return "warm-gray";
  if (text.includes("ote") || text.includes("test") || text.includes("external")) return "blue";
  return "gray";
}

function Badge({ value }: { value?: string | null }) {
  const text = String(value || "unknown");
  return <Tag type={tagType(text)}>{text.replaceAll("_", " ")}</Tag>;
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
    weight: String(record.weight ?? 0),
    port: String(record.port ?? ""),
    target: String(record.target ?? ""),
    flag: String(record.flag ?? 0),
    tag: String(record.tag ?? "issue"),
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
      if (editingId) await dnsToolsApi(`/domains/${domainId}/records/${editingId}`, { method: "PUT", body: payload(record) });
      else await dnsToolsApi(`/domains/${domainId}/records`, { method: "POST", body: payload(record) });
      setEditingId(null);
      setRecord(emptyRecord());
    });
  };

  const type = record.type.toUpperCase();
  const env = state?.domain.environment || "production";

  return <main className="dashboard-content carbon-dns-page">
    <div className="page-heading carbon-page-heading">
      <div><a className="back-link" href={`/dashboard/domains/${domainId}`}>← Domain</a><div className="title-with-status"><h1>DNS settings</h1><Tag type={env === "ote" ? "blue" : "green"}>{env === "ote" ? "TEST / OTE" : "LIVE"}</Tag></div><p>{state?.domain.domainName || "Domain DNS management"}</p></div>
      <div className="heading-actions"><Button kind="secondary" disabled={Boolean(busy)} onClick={() => void run("sync", () => dnsToolsApi(`/domains/${domainId}/sync`, { method: "POST" }))}>Sync from provider</Button><Button kind="ghost" disabled={Boolean(busy)} onClick={() => void load().catch((caught) => setError(errorText(caught)))}>Refresh</Button></div>
    </div>

    {env === "ote" ? <InlineNotification kind="warning" lowContrast hideCloseButton title="Test domain" subtitle="DNS changes are sent only to DomainNameAPI OTE and cannot affect the production registrar balance." /> : null}
    {state?.providerError ? <InlineNotification kind="warning" lowContrast hideCloseButton title="Provider sync failed" subtitle={`${state.providerError}. Local records remain visible and were not deleted.`} /> : null}
    {state?.warning ? <InlineNotification kind="warning" lowContrast hideCloseButton title="Nameserver warning" subtitle={state.warning} /> : null}
    {error ? <InlineNotification kind="error" lowContrast hideCloseButton title="DNS operation failed" subtitle={error} /> : null}

    {!state ? <InlineLoading description="Loading DNS settings…" /> : <Grid fullWidth className="carbon-dns-grid">
      <Column sm={4} md={8} lg={8}><Tile className="carbon-dns-panel"><div className="card-heading"><div><h2>Nameservers</h2><p>DomainNameAPI accepts between 2 and 13 nameservers.</p></div><Badge value={state.managedDns ? "managed_dns_active" : "external_dns"} /></div>
        <div className="carbon-form-stack">{nameservers.map((value, index) => <div className="carbon-inline-field" key={index}><TextInput id={`dns-ns-${index}`} labelText={`Nameserver ${index + 1}`} value={value} onChange={(event) => setNameservers(nameservers.map((item, position) => position === index ? event.target.value : item))} placeholder={`ns${index + 1}.example.com`} /><Button type="button" kind="danger--ghost" size="sm" disabled={nameservers.length <= 2} onClick={() => setNameservers(nameservers.filter((_, position) => position !== index))}>Remove</Button></div>)}
          <div className="heading-actions"><Button type="button" kind="tertiary" size="sm" disabled={nameservers.length >= 13} onClick={() => setNameservers([...nameservers, ""])}>Add nameserver</Button><Button type="button" disabled={Boolean(busy)} onClick={() => void run("nameservers", () => dnsToolsApi(`/domains/${domainId}/nameservers`, { method: "PUT", body: { nameServers: nameservers.filter(Boolean) } }))}>Save nameservers</Button></div>
        </div>
      </Tile></Column>

      <Column sm={4} md={8} lg={8}><Tile className="carbon-dns-panel"><div className="card-heading"><div><h2>{editingId ? "Edit DNS record" : "Add DNS record"}</h2><p>Records are validated locally, sent to the provider, then applied to the zone.</p></div></div>
        <form className="carbon-form-stack" onSubmit={submitRecord}>
          <Grid condensed><Column sm={4} md={3} lg={6}><TextInput id="dns-record-name" labelText="Name" value={record.name} onChange={(event) => setRecord({ ...record, name: event.target.value })} required /></Column><Column sm={4} md={2} lg={4}><Select id="dns-record-type" labelText="Type" value={type} onChange={(event) => setRecord({ ...emptyRecord(), name: record.name, type: event.target.value })}>{["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"].map((item) => <SelectItem key={item} value={item} text={item} />)}</Select></Column><Column sm={4} md={3} lg={6}><TextInput id="dns-record-ttl" type="number" labelText="TTL" min={1} max={86400} value={record.ttl} onChange={(event) => setRecord({ ...record, ttl: event.target.value })} required /></Column></Grid>

          {type === "MX" ? <Grid condensed><Column sm={4} md={4} lg={8}><TextInput id="dns-mx-priority" type="number" labelText="Priority" min={0} max={65535} value={record.priority} onChange={(event) => setRecord({ ...record, priority: event.target.value })} /></Column><Column sm={4} md={4} lg={8}><TextInput id="dns-mx-target" labelText="Mail server" value={record.target} onChange={(event) => setRecord({ ...record, target: event.target.value })} required /></Column></Grid> : null}

          {type === "SRV" ? <><Grid condensed><Column sm={4} md={2} lg={5}><TextInput id="dns-srv-priority" type="number" labelText="Priority" value={record.priority} onChange={(event) => setRecord({ ...record, priority: event.target.value })} /></Column><Column sm={4} md={2} lg={5}><TextInput id="dns-srv-weight" type="number" labelText="Weight" value={record.weight} onChange={(event) => setRecord({ ...record, weight: event.target.value })} /></Column><Column sm={4} md={4} lg={6}><TextInput id="dns-srv-port" type="number" labelText="Port" min={1} max={65535} value={record.port} onChange={(event) => setRecord({ ...record, port: event.target.value })} required /></Column></Grid><TextInput id="dns-srv-target" labelText="Target" value={record.target} onChange={(event) => setRecord({ ...record, target: event.target.value })} required /></> : null}

          {type === "CAA" ? <Grid condensed><Column sm={4} md={2} lg={4}><TextInput id="dns-caa-flag" type="number" labelText="Flag" min={0} max={255} value={record.flag} onChange={(event) => setRecord({ ...record, flag: event.target.value })} /></Column><Column sm={4} md={2} lg={4}><Select id="dns-caa-tag" labelText="Tag" value={record.tag} onChange={(event) => setRecord({ ...record, tag: event.target.value })}><SelectItem value="issue" text="issue" /><SelectItem value="issuewild" text="issuewild" /><SelectItem value="iodef" text="iodef" /></Select></Column><Column sm={4} md={4} lg={8}><TextInput id="dns-caa-value" labelText="Value" value={record.value} onChange={(event) => setRecord({ ...record, value: event.target.value })} required /></Column></Grid> : null}

          {!['MX', 'SRV', 'CAA'].includes(type) ? <TextArea id="dns-record-value" labelText={type === "TXT" ? "Value" : "Value(s)"} value={record.value} onChange={(event) => setRecord({ ...record, value: event.target.value })} placeholder="One value per line or comma separated" required /> : null}
          <div className="heading-actions"><Button type="submit" disabled={busy === "record"}>{editingId ? "Save record" : "Add record"}</Button>{editingId ? <Button type="button" kind="secondary" onClick={() => { setEditingId(null); setRecord(emptyRecord()); }}>Cancel</Button> : null}</div>
        </form>
      </Tile></Column>

      <Column sm={4} md={8} lg={16}><Tile className="carbon-dns-panel carbon-table-section"><div className="card-heading"><div><h2>DNS records</h2><p>{state.records.length} record(s) stored after provider synchronization.</p></div></div>
        {state.records.length ? <Table size="lg"><TableHead><TableRow><TableHeader>Name</TableHeader><TableHeader>Type</TableHeader><TableHeader>Value</TableHeader><TableHeader>TTL</TableHeader><TableHeader>Status</TableHeader><TableHeader>Source</TableHeader><TableHeader>Synced</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>{state.records.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell><Tag type="cool-gray">{item.type}</Tag></TableCell><TableCell>{Array.isArray(item.contents) ? item.contents.join(", ") : "—"}</TableCell><TableCell>{item.ttl}</TableCell><TableCell><Badge value={item.status} /></TableCell><TableCell>{item.source || "local"}</TableCell><TableCell>{formatDate(item.synced_at || item.updated_at)}</TableCell><TableCell><div className="heading-actions"><Button kind="ghost" size="sm" onClick={() => { setEditingId(item.id); setRecord(formFromRecord(item)); }}>Edit</Button><Button kind="ghost" size="sm" disabled={Boolean(busy)} onClick={() => void run(`retry-${item.id}`, () => dnsToolsApi(`/domains/${domainId}/records/${item.id}`, { method: "PUT", body: payload(formFromRecord(item)) }))}>Retry</Button><Button kind="danger--ghost" size="sm" disabled={Boolean(busy)} onClick={() => window.confirm(`Delete ${item.type} ${item.name}?`) && void run(`delete-${item.id}`, () => dnsToolsApi(`/domains/${domainId}/records/${item.id}`, { method: "DELETE" }))}>Delete</Button></div></TableCell></TableRow>)}</TableBody></Table> : <Tile className="carbon-empty-state"><h3>No DNS records</h3><p>Add a record or retry provider synchronization.</p></Tile>}
      </Tile></Column>
    </Grid>}
  </main>;
}
