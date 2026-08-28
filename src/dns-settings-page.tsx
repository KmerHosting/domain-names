import {
  Button,
  Column,
  Grid,
  InlineLoading,
  InlineNotification,
  Modal,
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
  const values = Array.isArray(record.contents) ? record.contents.map(String) : [];
  const content = values.join("\n");
  const type = String(record.type || "A").toUpperCase();
  const first = values[0] || "";
  const mx = type === "MX" ? first.match(/^(\\d+)\\s+(.+)$/) : null;
  const srv = type === "SRV" ? first.match(/^(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(.+)$/) : null;
  const caa = type === "CAA" ? first.match(/^(\\d+)\\s+([a-z0-9]+)\\s+"?(.*?)"?$/i) : null;
  return {
    name: record.name || "@",
    type,
    value: caa ? caa[3] : type === "MX" || type === "SRV" ? "" : content,
    ttl: String(record.ttl || 3600),
    priority: String(record.priority ?? mx?.[1] ?? srv?.[1] ?? 10),
    weight: String(record.weight ?? srv?.[2] ?? 0),
    port: String(record.port ?? srv?.[3] ?? ""),
    target: String(record.target ?? mx?.[2] ?? srv?.[4] ?? ""),
    flag: String(record.flag ?? caa?.[1] ?? 0),
    tag: String(record.tag ?? caa?.[2] ?? "issue"),
  };
}

function isSystemRecord(record: Row) {
  return ["SOA", "RRSIG", "DNSKEY", "NSEC", "NSEC3"].includes(String(record.type || "").toUpperCase());
}

export function DnsSettingsPage() {
  const domainId = useMemo(domainIdFromPath, []);
  const [state, setState] = useState<DnsState | null>(null);
  const [record, setRecord] = useState<RecordFormState>(emptyRecord());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameservers, setNameservers] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);

  const load = async () => {
    const next = await dnsToolsApi<DnsState>(`/domains/${domainId}/records`);
    setState(next);
    setNameservers(next.domain.nameservers?.length ? next.domain.nameservers : ["", ""]);
  };

  useEffect(() => {
    load().catch((caught) => setError(errorText(caught)));
  }, [domainId]);

  const run = async (name: string, action: () => Promise<unknown>, successMessage?: string) => {
    setBusy(name);
    setError(null);
    setSuccess(null);
    try {
      await action();
      await load();
      if (successMessage) setSuccess(successMessage);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  const submitRecord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = payload(record);
    if (!Number.isFinite(draft.ttl) || draft.ttl < 60 || draft.ttl > 86400) {
      setError("TTL must be between 60 and 86400 seconds.");
      setSuccess(null);
      return;
    }
    if (!draft.contents?.length && !["MX", "SRV", "CAA"].includes(record.type.toUpperCase())) {
      setError("Enter at least one DNS value.");
      setSuccess(null);
      return;
    }
    if (record.type.toUpperCase() === "MX" && !record.target.trim()) {
      setError("Enter a mail server target.");
      setSuccess(null);
      return;
    }
    if (record.type.toUpperCase() === "SRV" && (!record.target.trim() || !record.port.trim())) {
      setError("Enter a target and port for the SRV record.");
      setSuccess(null);
      return;
    }
    if (record.type.toUpperCase() === "CAA" && !record.value.trim()) {
      setError("Enter a CAA value.");
      setSuccess(null);
      return;
    }
    await run(
      "record",
      async () => {
        if (editingId) await dnsToolsApi(`/domains/${domainId}/records/${editingId}`, { method: "PUT", body: draft });
        else await dnsToolsApi(`/domains/${domainId}/records`, { method: "POST", body: draft });
        setEditingId(null);
        setRecord(emptyRecord());
      },
      editingId ? "DNS record updated." : "DNS record added.",
    );
  };

  const type = record.type.toUpperCase();
  const env = state?.domain.environment || "production";

  return <main className="dashboard-content carbon-dns-page">
    <div className="page-heading carbon-page-heading">
      <div><a className="back-link" href={`/dashboard/domains/${domainId}`}>← Domain</a><div className="title-with-status"><h1>DNS settings</h1><Tag type={env === "ote" ? "blue" : "green"}>{env === "ote" ? "TEST / OTE" : "LIVE"}</Tag></div><p>{state?.domain.domainName || "Domain DNS management"}</p></div>
      <div className="heading-actions"><Button kind="secondary" disabled={Boolean(busy)} aria-busy={busy === "sync"} onClick={() => void run("sync", () => dnsToolsApi(`/domains/${domainId}/sync`, { method: "POST" }), "DNS records synchronized.")}>{busy === "sync" ? "Syncing…" : "Sync from provider"}</Button><Button kind="ghost" disabled={Boolean(busy)} onClick={() => { setError(null); setSuccess(null); void load().catch((caught) => setError(errorText(caught))); }}>Refresh</Button></div>
    </div>

    {env === "ote" ? <InlineNotification kind="warning" lowContrast hideCloseButton title="Test domain" subtitle="DNS changes are sent only to DomainNameAPI OTE and cannot affect the production registrar balance." /> : null}
    {state?.providerError ? <InlineNotification kind="warning" lowContrast hideCloseButton title="Provider sync failed" subtitle={`${state.providerError}. Local records remain visible and were not deleted.`} /> : null}
    {state?.warning ? <InlineNotification kind="warning" lowContrast hideCloseButton title="Nameserver warning" subtitle={state.warning} /> : null}
    {success ? <InlineNotification kind="success" lowContrast hideCloseButton title="Done" subtitle={success} /> : null}
    {error ? <InlineNotification kind="error" lowContrast hideCloseButton title="DNS operation failed" subtitle={error} /> : null}

    {!state ? <InlineLoading description="Loading DNS settings…" /> : <Grid fullWidth className="carbon-dns-grid">
      <Column sm={4} md={8} lg={8}><Tile className="carbon-dns-panel"><div className="card-heading"><div><h2>Nameservers</h2><p>DomainNameAPI accepts between 2 and 13 nameservers.</p></div><Badge value={state.managedDns ? "managed_dns_active" : "external_dns"} /></div>
        <div className="carbon-form-stack">{nameservers.map((value, index) => <div className="carbon-inline-field" key={index}><TextInput id={`dns-ns-${index}`} labelText={`Nameserver ${index + 1}`} value={value} onChange={(event) => setNameservers(nameservers.map((item, position) => position === index ? event.target.value : item))} placeholder={`ns${index + 1}.example.com`} /><Button type="button" kind="danger--ghost" size="sm" disabled={nameservers.length <= 2} onClick={() => setNameservers(nameservers.filter((_, position) => position !== index))}>Remove</Button></div>)}
          <div className="heading-actions"><Button type="button" kind="tertiary" size="sm" disabled={nameservers.length >= 13} onClick={() => setNameservers([...nameservers, ""])}>Add nameserver</Button><Button type="button" disabled={Boolean(busy)} onClick={() => {
            const normalized = nameservers.map((item) => item.trim().replace(/\\.$/, "").toLowerCase()).filter(Boolean);
            if (normalized.length < 2) { setError("Provide at least two nameservers."); setSuccess(null); return; }
            if (new Set(normalized).size !== normalized.length) { setError("Nameservers must be unique."); setSuccess(null); return; }
            void run("nameservers", () => dnsToolsApi(`/domains/${domainId}/nameservers`, { method: "PUT", body: { nameServers: normalized } }), "Nameservers saved.");
          }}>Save nameservers</Button></div>
        </div>
      </Tile></Column>

      <Column sm={4} md={8} lg={8}><Tile className="carbon-dns-panel"><div className="card-heading"><div><h2>{editingId ? "Edit DNS record" : "Add DNS record"}</h2><p>Records are validated locally, sent to the provider, then applied to the zone.</p></div></div>
        <form className="carbon-form-stack" onSubmit={submitRecord}>
          <Grid condensed><Column sm={4} md={3} lg={6}><TextInput id="dns-record-name" labelText="Name" value={record.name} onChange={(event) => setRecord({ ...record, name: event.target.value })} required /></Column><Column sm={4} md={2} lg={4}><Select id="dns-record-type" labelText="Type" value={type} onChange={(event) => setRecord({ ...emptyRecord(), name: record.name, type: event.target.value })}>{["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"].map((item) => <SelectItem key={item} value={item} text={item} />)}</Select></Column><Column sm={4} md={3} lg={6}><TextInput id="dns-record-ttl" type="number" labelText="TTL" min={60} max={86400} value={record.ttl} onChange={(event) => setRecord({ ...record, ttl: event.target.value })} required /></Column></Grid>

          {type === "MX" ? <Grid condensed><Column sm={4} md={4} lg={8}><TextInput id="dns-mx-priority" type="number" labelText="Priority" min={0} max={65535} value={record.priority} onChange={(event) => setRecord({ ...record, priority: event.target.value })} /></Column><Column sm={4} md={4} lg={8}><TextInput id="dns-mx-target" labelText="Mail server" value={record.target} onChange={(event) => setRecord({ ...record, target: event.target.value })} required /></Column></Grid> : null}

          {type === "SRV" ? <><Grid condensed><Column sm={4} md={2} lg={5}><TextInput id="dns-srv-priority" type="number" labelText="Priority" value={record.priority} onChange={(event) => setRecord({ ...record, priority: event.target.value })} /></Column><Column sm={4} md={2} lg={5}><TextInput id="dns-srv-weight" type="number" labelText="Weight" value={record.weight} onChange={(event) => setRecord({ ...record, weight: event.target.value })} /></Column><Column sm={4} md={4} lg={6}><TextInput id="dns-srv-port" type="number" labelText="Port" min={1} max={65535} value={record.port} onChange={(event) => setRecord({ ...record, port: event.target.value })} required /></Column></Grid><TextInput id="dns-srv-target" labelText="Target" value={record.target} onChange={(event) => setRecord({ ...record, target: event.target.value })} required /></> : null}

          {type === "CAA" ? <Grid condensed><Column sm={4} md={2} lg={4}><TextInput id="dns-caa-flag" type="number" labelText="Flag" min={0} max={255} value={record.flag} onChange={(event) => setRecord({ ...record, flag: event.target.value })} /></Column><Column sm={4} md={2} lg={4}><Select id="dns-caa-tag" labelText="Tag" value={record.tag} onChange={(event) => setRecord({ ...record, tag: event.target.value })}><SelectItem value="issue" text="issue" /><SelectItem value="issuewild" text="issuewild" /><SelectItem value="iodef" text="iodef" /></Select></Column><Column sm={4} md={4} lg={8}><TextInput id="dns-caa-value" labelText="Value" value={record.value} onChange={(event) => setRecord({ ...record, value: event.target.value })} required /></Column></Grid> : null}

          {!['MX', 'SRV', 'CAA'].includes(type) ? <TextArea id="dns-record-value" labelText={type === "TXT" ? "Value" : "Value(s)"} value={record.value} onChange={(event) => setRecord({ ...record, value: event.target.value })} placeholder="One value per line or comma separated" required /> : null}
          <div className="heading-actions"><Button type="submit" disabled={busy === "record"}>{editingId ? "Save record" : "Add record"}</Button>{editingId ? <Button type="button" kind="secondary" onClick={() => { setEditingId(null); setRecord(emptyRecord()); }}>Cancel</Button> : null}</div>
        </form>
      </Tile></Column>

      <Column sm={4} md={8} lg={16}><Tile className="carbon-dns-panel carbon-table-section"><div className="card-heading"><div><h2>DNS records</h2><p>{state.records.length} record(s) stored after provider synchronization.</p></div></div>
        {state.records.length ? <Table size="lg"><TableHead><TableRow><TableHeader>Name</TableHeader><TableHeader>Type</TableHeader><TableHeader>Value</TableHeader><TableHeader>TTL</TableHeader><TableHeader>Status</TableHeader><TableHeader>Source</TableHeader><TableHeader>Synced</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>{state.records.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell><Tag type="cool-gray">{item.type}</Tag></TableCell><TableCell>{Array.isArray(item.contents) ? item.contents.join(", ") : "—"}</TableCell><TableCell>{item.ttl}</TableCell><TableCell><Badge value={item.status} /></TableCell><TableCell>{item.source || "local"}</TableCell><TableCell>{formatDate(item.synced_at || item.updated_at)}</TableCell><TableCell>{isSystemRecord(item) ? <Tag type="cool-gray">Read only</Tag> : <div className="heading-actions"><Button kind="ghost" size="sm" onClick={() => { setEditingId(item.id); setRecord(formFromRecord(item)); }}>Edit</Button><Button kind="ghost" size="sm" disabled={Boolean(busy)} onClick={() => void run(`retry-${item.id}`, () => dnsToolsApi(`/domains/${domainId}/records/${item.id}`, { method: "PUT", body: payload(formFromRecord(item)) }), "DNS record retried.")}>Retry</Button><Button kind="danger--ghost" size="sm" disabled={Boolean(busy)} onClick={() => setDeleteTarget(item)}>Delete</Button></div>}</TableCell></TableRow>)}</TableBody></Table> : <Tile className="carbon-empty-state"><h3>No DNS records</h3><p>Add a record or retry provider synchronization.</p></Tile>}
      </Tile></Column>
    </Grid>}

    <Modal
      open={Boolean(deleteTarget)}
      danger
      modalHeading="Delete DNS record"
      primaryButtonText={busy?.startsWith("delete-") ? "Deleting…" : "Delete"}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={Boolean(busy)}
      onRequestClose={() => { if (!busy) setDeleteTarget(null); }}
      onRequestSubmit={() => {
        if (!deleteTarget || busy) return;
        void run(`delete-${deleteTarget.id}`, () => dnsToolsApi(`/domains/${domainId}/records/${deleteTarget.id}`, { method: "DELETE" }), "DNS record deleted.")
          .finally(() => setDeleteTarget(null));
      }}
    >
      <p className="khd-modal-copy">Delete <strong>{deleteTarget?.type} {deleteTarget?.name}</strong> from the provider zone?</p>
    </Modal>
  </main>;
}
