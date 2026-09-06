import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Column,
  Grid,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  SkeletonText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextInput,
  Tile,
  Toggle,
} from "@carbon/react";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import {
  adminApi,
  adminMonitorApi,
  api,
  customerToolsApi,
  formatDate,
  formatMoney,
  getSession,
  newIdempotencyKey,
} from "./api";
import { useDomainCopy } from "./domain-i18n";
import { useDomainNativeCopy } from "./domain-native-i18n";

type Row = Record<string, any>;
type Route =
  | { kind: "notifications" }
  | { kind: "domainManage"; domainId: string }
  | null;

function route(pathname = window.location.pathname): Route {
  if (pathname === "/dashboard/notifications") return { kind: "notifications" };
  const manage = pathname.match(/^\/dashboard\/domains\/([^/]+)\/manage$/);
  if (manage) return { kind: "domainManage", domainId: manage[1] };
  return null;
}

export function isNativePage(pathname = window.location.pathname): boolean {
  return Boolean(route(pathname));
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

function validHostname(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  return host.length >= 3 && host.length <= 253 && host.split(".").every((label) =>
    label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  );
}

function validChildHostname(value: string, domainName: string): boolean {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  const domain = domainName.trim().toLowerCase().replace(/\.$/, "");
  return validHostname(host) && (!host.includes(".") || host.endsWith("." + domain));
}

function validIpAddress(value: string): boolean {
  const ip = value.trim();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return ip.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);
  }
  return /^[0-9a-f:]+$/i.test(ip) && ip.includes(":");
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function tagType(value?: string | null): "green" | "red" | "warm-gray" | "blue" | "gray" {
  const text = String(value || "unknown").toLowerCase().replaceAll("_", "-");
  if (["active", "completed", "paid", "verified", "live", "enabled", "success"].some((item) => text.includes(item))) return "green";
  if (["failed", "error", "expired", "disabled", "cancelled"].some((item) => text.includes(item))) return "red";
  if (["pending", "processing", "queued", "never"].some((item) => text.includes(item))) return "warm-gray";
  if (["ote", "test"].some((item) => text.includes(item))) return "blue";
  return "gray";
}

function Badge({ value }: { value?: string | null }) {
  const text = String(value || "unknown");
  return <Tag type={tagType(text)}>{text.replaceAll("_", " ")}</Tag>;
}

function Loading({ description = "Loading…" }: { description?: string }) {
  const copy = useDomainCopy();
  const label = description === "Loading…" ? copy.loading : description;
  return <Tile className="carbon-loading-block" aria-label={label} aria-busy="true"><SkeletonText heading width="42%" /><SkeletonText paragraph lineCount={3} width="82%" /></Tile>;
}

function ErrorNotice({ error, title = "Request failed" }: { error: unknown; title?: string }) {
  return <InlineNotification kind="error" lowContrast hideCloseButton title={title} subtitle={errorText(error)} />;
}

function Shell({ title, subtitle, back, children }: { title: string; subtitle: string; back: string; children: ReactNode }) {
  const copy = useDomainCopy();
  return <main className="dashboard-content carbon-native-page"><div className="page-heading carbon-page-heading"><div><a className="back-link" href={back}>{copy.domains}</a><span className="kicker">KmerHosting Domains</span><h1>{title}</h1><p>{subtitle}</p></div></div>{children}</main>;
}

function AdminShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <main className="admin-main carbon-native-page"><div className="page-heading carbon-page-heading"><div><span className="kicker">Domain administration</span><h1>{title}</h1><p>{subtitle}</p></div></div>{children}</main>;
}

function MetricGrid({ metrics }: { metrics: Array<[string, ReactNode]> }) {
  return <Grid fullWidth className="carbon-metric-grid">{metrics.map(([label, value]) => <Column sm={4} md={4} lg={4} key={label}><Tile className="carbon-metric"><span>{label}</span><strong>{value}</strong></Tile></Column>)}</Grid>;
}

function NotificationsPage() {
  const copy = useDomainCopy();
  const nativeCopy = useDomainNativeCopy();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["notifications"], queryFn: () => customerToolsApi<{ notifications: Row[]; unread: number }>("/notifications"), refetchInterval: 30000 });
  const readOne = useMutation({ mutationFn: (id: string) => customerToolsApi(`/notifications/${id}/read`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["notifications"] }) });
  const readAll = useMutation({ mutationFn: () => customerToolsApi("/notifications/read-all", { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["notifications"] }) });
  return <Shell title={copy.notifications} subtitle={nativeCopy.activitySubtitle} back="/dashboard"><Tile className="carbon-dashboard-panel"><div className="card-heading"><div><h2>{copy.notifications}</h2><p>{query.data?.unread || 0} {nativeCopy.unread}.</p></div><Button kind="secondary" size="sm" onClick={() => readAll.mutate()} disabled={readAll.isPending}>{nativeCopy.readAll}</Button></div>{query.isPending ? <Loading /> : query.isError ? <ErrorNotice error={query.error} /> : <div className="carbon-activity-list">{(query.data?.notifications || []).map((item) => <Tile className="carbon-notification-row" key={item.id}><div><strong>{item.title}</strong><p>{item.message}</p><small>{formatDate(item.created_at)} · {item.type || "account"}</small></div>{!item.read_at ? <Button kind="ghost" size="sm" onClick={() => readOne.mutate(item.id)}>{nativeCopy.markRead}</Button> : <Badge value="read" />}</Tile>)}</div>}</Tile></Shell>;
}

function ProviderAction({ title, description, action, busy, danger = false }: { title: string; description: string; action: () => void; busy: boolean; danger?: boolean }) {
  return <Tile className="carbon-action-tile"><strong>{title}</strong><p>{description}</p><Button kind={danger ? "danger--tertiary" : "tertiary"} size="sm" onClick={action} disabled={busy}>{busy ? "Working…" : title}</Button></Tile>;
}

function Forwarding({ domainId }: { domainId: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["forwarding", domainId], queryFn: () => customerToolsApi<{ forwarding: Row | null; provider?: Row | null }>(`/domains/${domainId}/forwarding`) });
  const save = useMutation({ mutationFn: (body: Row) => customerToolsApi(`/domains/${domainId}/forwarding`, { method: "PUT", body }), onSuccess: () => client.invalidateQueries({ queryKey: ["forwarding", domainId] }) });
  const remove = useMutation({ mutationFn: () => customerToolsApi(`/domains/${domainId}/forwarding`, { method: "DELETE" }), onSuccess: () => client.invalidateQueries({ queryKey: ["forwarding", domainId] }) });
  const current = query.data?.forwarding;
  const [redirectAddress, setRedirectAddress] = useState("");
  const [forwardingAttempted, setForwardingAttempted] = useState(false);

  useEffect(() => {
    setRedirectAddress(String(current?.redirect_address || current?.redirect_url || ""));
    setForwardingAttempted(false);
  }, [current?.id, current?.redirect_address, current?.redirect_url]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setForwardingAttempted(true);
    if (!validHttpUrl(redirectAddress)) return;
    save.mutate({ redirectAddress: redirectAddress.trim(), forwardType: new FormData(event.currentTarget).get("forwardType") });
  };

  return <Tile className="carbon-dashboard-panel"><div className="card-heading"><div><h2>Web forwarding</h2><p>Choose where visitors should go when they use this domain.</p></div>{current ? <Badge value={current.status} /> : null}</div>{query.isPending ? <Loading /> : query.isError ? <ErrorNotice error={query.error} /> : <><p>{current ? <>Active: <strong>{current.redirect_address || current.redirect_url}</strong></> : "No active forwarding rule."}</p><form className="carbon-form-stack" onSubmit={submit} noValidate key={current?.id || "new"}><TextInput id="forward-url" name="redirectAddress" type="url" labelText="Redirect URL" helperText="Use a complete http:// or https:// address." value={redirectAddress} onChange={(event) => setRedirectAddress(event.target.value)} required invalid={forwardingAttempted && !validHttpUrl(redirectAddress)} invalidText="Enter a complete http:// or https:// address." /><Select id="forward-type" name="forwardType" labelText="Forward type" helperText="Standard redirects visitors; Frame keeps the domain in the browser address bar." defaultValue={current?.forward_type || "Standard"}><SelectItem value="Standard" text="Standard redirect" /><SelectItem value="Frame" text="Frame redirect" /></Select><div className="heading-actions"><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save forwarding"}</Button>{current ? <Button type="button" kind="danger--ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button> : null}</div></form>{save.isError || remove.isError ? <ErrorNotice error={save.error || remove.error} /> : null}</>}</Tile>;
}

function GlueHosts({ domainId, domainName }: { domainId: string; domainName: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["glue-hosts", domainId], queryFn: () => customerToolsApi<{ glueHosts: Row[] }>(`/domains/${domainId}/glue-hosts`) });
  const add = useMutation({ mutationFn: (body: Row) => customerToolsApi(`/domains/${domainId}/glue-hosts`, { method: "POST", body }), onSuccess: () => client.invalidateQueries({ queryKey: ["glue-hosts", domainId] }) });
  const edit = useMutation({ mutationFn: ({ id, ips, name }: { id: string; ips: string[]; name: string }) => customerToolsApi(`/domains/${domainId}/glue-hosts/${id}`, { method: "PUT", body: { newHostName: name, ipAddresses: ips } }), onSuccess: () => client.invalidateQueries({ queryKey: ["glue-hosts", domainId] }) });
  const remove = useMutation({ mutationFn: (id: string) => customerToolsApi(`/domains/${domainId}/glue-hosts/${id}`, { method: "DELETE" }), onSuccess: () => client.invalidateQueries({ queryKey: ["glue-hosts", domainId] }) });
  const [editingHost, setEditingHost] = useState<Row | null>(null);
  const [editIps, setEditIps] = useState("");
  const [editIpsAttempted, setEditIpsAttempted] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [glueHost, setGlueHost] = useState("");
  const [glueIps, setGlueIps] = useState("");
  const [glueAttempted, setGlueAttempted] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setGlueAttempted(true);
    const hostName = glueHost.trim();
    const ipAddresses = glueIps.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
    if (!validChildHostname(hostName, domainName) || ipAddresses.length === 0 || ipAddresses.some((value) => !validIpAddress(value))) return;
    add.mutate({ hostName, ipAddresses }, { onSuccess: () => {
      setGlueHost("");
      setGlueIps("");
      event.currentTarget.reset();
    } });
  };
  return <Tile className="carbon-dashboard-panel carbon-table-section"><div className="card-heading"><div><h2>Child nameservers / glue hosts</h2><p>Use a full child hostname under {domainName} and one or more IPv4/IPv6 addresses.</p></div></div><form className="carbon-glue-form" onSubmit={submit} noValidate><TextInput id="glue-host" name="hostName" labelText="Host name" helperText={`Use a hostname under ${domainName}.`} value={glueHost} onChange={(event) => setGlueHost(event.target.value)} placeholder={`ns1.${domainName}`} required invalid={glueAttempted && !validChildHostname(glueHost, domainName)} invalidText={`Enter a valid child host under ${domainName}.`} /><TextInput id="glue-ips" name="ipAddresses" labelText="IP addresses" helperText="Separate multiple IPv4 or IPv6 addresses with commas." value={glueIps} onChange={(event) => setGlueIps(event.target.value)} placeholder="192.0.2.10, 2001:db8::10" required invalid={glueAttempted && (glueIps.split(/[\s,]+/).filter(Boolean).length === 0 || glueIps.split(/[\s,]+/).filter(Boolean).some((value) => !validIpAddress(value)))} invalidText="Enter valid IPv4 or IPv6 addresses." /><Button type="submit" disabled={add.isPending}>Add</Button></form>{query.isPending ? <Loading /> : query.isError ? <ErrorNotice error={query.error} /> : (query.data?.glueHosts || []).length ? <Table size="lg"><TableHead><TableRow><TableHeader>Host</TableHeader><TableHeader>IP addresses</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>{(query.data?.glueHosts || []).map((host) => <TableRow key={host.id}><TableCell>{host.host_name}</TableCell><TableCell>{(host.ip_addresses || []).join(", ")}</TableCell><TableCell><Badge value={host.status} /></TableCell><TableCell><div className="heading-actions"><Button kind="ghost" size="sm" onClick={() => { setEditingHost(host); setEditIps((host.ip_addresses || []).join(", ")); setEditIpsAttempted(false); }}>Edit</Button><Button kind="danger--ghost" size="sm" onClick={() => setDeleteTarget(host)}>Delete</Button></div></TableCell></TableRow>)}</TableBody></Table> : <Tile className="carbon-empty-state"><h3>No glue hosts</h3><p>Add a child nameserver when your domain needs registrar glue records.</p></Tile>}{add.isError || edit.isError || remove.isError ? <ErrorNotice error={add.error || edit.error || remove.error} /> : null}
    <Modal
      open={Boolean(editingHost)}
      modalHeading="Edit child nameserver"
      primaryButtonText={edit.isPending ? "Saving…" : "Save"}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={edit.isPending || !editIps.trim()}
      onRequestClose={() => setEditingHost(null)}
      onRequestSubmit={() => {
        if (!editingHost) return;
        setEditIpsAttempted(true);
        const ips = editIps.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
        if (!ips.length || ips.some((value) => !validIpAddress(value))) return;
        edit.mutate(
          { id: editingHost.id, name: editingHost.host_name, ips },
          { onSuccess: () => setEditingHost(null) },
        );
      }}
    >
      <p>Update the IPv4 or IPv6 addresses for <strong>{editingHost?.host_name}</strong>.</p>
      <TextInput
        id="edit-glue-ips"
        labelText="IP addresses"
        helperText="Separate multiple addresses with spaces or commas."
        value={editIps}
        onChange={(event) => setEditIps(event.target.value)}
        invalid={editIpsAttempted && (!editIps.trim() || editIps.split(/[\s,]+/).filter(Boolean).some((value) => !validIpAddress(value)))}
        invalidText="Enter valid IPv4 or IPv6 addresses."
      />
    </Modal>
    <Modal
      open={Boolean(deleteTarget)}
      danger
      modalHeading="Delete child nameserver"
      primaryButtonText={remove.isPending ? "Deleting…" : "Delete"}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={remove.isPending}
      onRequestClose={() => setDeleteTarget(null)}
      onRequestSubmit={() => {
        if (!deleteTarget) return;
        remove.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
      }}
    >
      <p>Delete <strong>{deleteTarget?.host_name}</strong> and its glue addresses from the registrar.</p>
    </Modal>
  </Tile>;
}

function DomainContacts({ domainId }: { domainId: string }) {
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: () => api<{ contacts: Row[] }>("/contacts") });
  const save = useMutation({ mutationFn: (body: Row) => customerToolsApi(`/domains/${domainId}/contacts`, { method: "PUT", body }) });
  const [selected, setSelected] = useState("");
  const [contactAttempted, setContactAttempted] = useState(false);
  const rows = contacts.data?.contacts || [];
  return <Tile className="carbon-dashboard-panel"><div className="card-heading"><div><h2>WHOIS contacts</h2><p>Assign one contact to all four registry roles, or manage contacts from the Contacts page.</p></div><Button kind="tertiary" size="sm" href="/dashboard/contacts">Manage contacts</Button></div>{contacts.isPending ? <Loading /> : contacts.isError ? <ErrorNotice error={contacts.error} /> : <div className="carbon-contact-assignment"><Select id="domain-contact" labelText="Contact" value={selected} required invalid={contactAttempted && !selected} invalidText="Select a contact before applying it." onChange={(event) => setSelected(event.target.value)}><SelectItem value="" text="Select a contact" />{rows.map((contact) => <SelectItem key={contact.id} value={contact.id} text={`${contact.label || `${contact.first_name} ${contact.last_name}`} · ${contact.email}`} />)}</Select><Button disabled={save.isPending} onClick={() => { setContactAttempted(true); if (selected) save.mutate({ contactId: selected }); }}>{save.isPending ? "Applying…" : "Apply to all roles"}</Button></div>}{save.isSuccess ? <InlineNotification kind="success" lowContrast hideCloseButton title="Registry contacts updated" subtitle="The selected contact has been applied to all registry roles." /> : null}{save.isError ? <ErrorNotice error={save.error} /> : null}</Tile>;
}

function DomainManagePage({ domainId }: { domainId: string }) {
  const client = useQueryClient();
  const domainQuery = useQuery({ queryKey: ["domain-manage", domainId], queryFn: () => api<{ domain: Row }>(`/domains/${domainId}`) });
  const domain = domainQuery.data?.domain;
  const [transferCode, setTransferCode] = useState("");
  const [revealTransfer, setRevealTransfer] = useState(false);
  const [transferConfirm, setTransferConfirm] = useState<string | null>(null);
  const [quote, setQuote] = useState<Row | null>(null);
  const [renewalOrderKey, setRenewalOrderKey] = useState(() => newIdempotencyKey("renewal"));
  const [orderMessage, setOrderMessage] = useState("");
  const sync = useMutation({ mutationFn: () => customerToolsApi(`/domains/${domainId}/sync`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["domain-manage", domainId] }) });
  const lock = useMutation({ mutationFn: (enabled: boolean) => customerToolsApi(`/domains/${domainId}/lock`, { method: "PUT", body: { enabled } }), onSuccess: () => client.invalidateQueries({ queryKey: ["domain-manage", domainId] }) });
  const privacy = useMutation({ mutationFn: (enabled: boolean) => customerToolsApi(`/domains/${domainId}/privacy`, { method: "PUT", body: { enabled } }), onSuccess: () => client.invalidateQueries({ queryKey: ["domain-manage", domainId] }) });
  const epp = useMutation({ mutationFn: () => customerToolsApi<{ transferCode: string }>(`/domains/${domainId}/transfer-code`, { method: "POST", body: { confirm: true } }), onSuccess: (data) => setTransferCode(data.transferCode) });
  const transferAction = useMutation({ mutationFn: (action: string) => customerToolsApi(`/domains/${domainId}/transfer/${action}`, { method: "POST", body: { confirm: true } }), onSuccess: () => sync.mutate() });
  const getQuote = useMutation({ mutationFn: () => customerToolsApi<{ quote: Row }>(`/domains/${domainId}/quote?operation=renewal&years=1`), onSuccess: (data) => setQuote(data.quote) });
  const createOrder = useMutation({ mutationFn: () => customerToolsApi<{ order: Row }>(`/domains/${domainId}/orders/renewal`, { method: "POST", body: { years: 1, expectedPriceUsd: quote?.customerPriceUsd }, idempotencyKey: renewalOrderKey }), onSuccess: (data) => { setOrderMessage(`Order ${data.order?.order_number || "created"} was queued for processing.`); setQuote(null); setRenewalOrderKey(newIdempotencyKey("renewal")); } });

  if (domainQuery.isPending) return <Shell title="Domain management" subtitle="Loading domain data." back="/dashboard/domains"><Loading /></Shell>;
  if (domainQuery.isError || !domain) return <Shell title="Domain management" subtitle="Unable to load this domain." back="/dashboard/domains"><ErrorNotice error={domainQuery.error} /></Shell>;
  const test = domain.registrar_environment === "ote";
  const busy = sync.isPending || lock.isPending || privacy.isPending;

  return <Shell title={domain.domain_name} subtitle="Manage DNS, security, contacts and renewal." back={`/dashboard/domains/${domainId}`}>
    {test ? <InlineNotification kind="warning" lowContrast hideCloseButton title="Test domain" subtitle="Changes in this environment do not affect a live domain or your KmerHosting account balance." /> : null}
    <Tile className="carbon-dashboard-panel"><div className="card-heading"><div><h2>Domain status</h2><p>Last synchronized {formatDate(domain.last_synced_at)}.</p></div><div className="heading-actions"><Badge value={domain.status} />{test ? <Tag type="blue">TEST / OTE</Tag> : null}</div></div><MetricGrid metrics={[["Expires", formatDate(domain.expires_at)], ["Lock", domain.locked ? "Enabled" : "Disabled"], ["Privacy", domain.privacy_enabled ? "Enabled" : "Disabled"], ["Auto-renew", domain.auto_renew ? "Enabled" : "Disabled"]]} /><div className="heading-actions"><Button kind="tertiary" disabled={busy} onClick={() => sync.mutate()}>Refresh domain status</Button><Button kind="ghost" href={`/dashboard/domains/${domainId}/dns`}>DNS and nameservers</Button></div>{sync.isError ? <ErrorNotice error={sync.error} /> : null}</Tile>

    <Tile className="carbon-dashboard-panel"><div className="card-heading"><div><h2>Security and transfer code</h2><p>Changes may take a moment to appear.</p></div></div><Grid fullWidth className="carbon-action-grid"><Column sm={4} md={4} lg={5}><Tile className="carbon-action-tile"><Toggle id="domain-lock" labelText="Registrar lock" labelA="Unlocked" labelB="Locked" toggled={Boolean(domain.locked)} disabled={lock.isPending} onToggle={(enabled) => lock.mutate(enabled)} /><p>Protect the domain from unauthorized transfers.</p></Tile></Column><Column sm={4} md={4} lg={5}><Tile className="carbon-action-tile"><Toggle id="domain-privacy" labelText="WHOIS privacy" labelA="Disabled" labelB="Enabled" toggled={Boolean(domain.privacy_enabled)} disabled={privacy.isPending} onToggle={(enabled) => privacy.mutate(enabled)} /><p>Hide contact details where supported.</p></Tile></Column><Column sm={4} md={8} lg={6}><ProviderAction title="Reveal transfer code" description="Show the transfer authorization code. Keep it private." busy={epp.isPending} action={() => setRevealTransfer(true)} /></Column></Grid>{transferCode ? <InlineNotification kind="warning" lowContrast hideCloseButton title="Transfer code" subtitle={transferCode} /> : null}{lock.isError || privacy.isError || epp.isError ? <ErrorNotice error={lock.error || privacy.error || epp.error} /> : null}
      <Modal
        open={revealTransfer}
        modalHeading="Reveal transfer code"
        primaryButtonText={epp.isPending ? "Loading…" : "Reveal code"}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={epp.isPending}
        onRequestClose={() => setRevealTransfer(false)}
        onRequestSubmit={() => epp.mutate(undefined, { onSettled: () => setRevealTransfer(false) })}
      >
        <p>Anyone with this code may be able to transfer the domain. Keep it private.</p>
      </Modal>
    </Tile>

    <Tile className="carbon-dashboard-panel"><div className="card-heading"><div><h2>Renewal and restoration</h2><p>Check the current renewal price before confirming.</p></div></div><Grid fullWidth className="carbon-action-grid"><Column sm={4} md={4} lg={8}><ProviderAction title="Check renewal quote" description="Check whether renewal is available and see the current price." busy={getQuote.isPending} action={() => getQuote.mutate()} /></Column><Column sm={4} md={4} lg={8}><Tile className="carbon-action-tile"><strong>Domain restoration</strong><p>Restoration is not currently available for this domain.</p><Tag type="cool-gray">Currently unavailable</Tag></Tile></Column></Grid>{quote ? <Tile className="carbon-quote"><strong>{String(quote.operation).toUpperCase()}</strong><span>{formatMoney(quote.customerPriceUsd, quote.currency || "USD")}</span><small>{quote.periodYears} year renewal</small><Button disabled={createOrder.isPending} onClick={() => createOrder.mutate()}>{test ? "Queue OTE test order" : "Charge central balance and confirm"}</Button></Tile> : null}{orderMessage ? <InlineNotification kind="success" lowContrast hideCloseButton title="Order queued" subtitle={orderMessage} actions={<Button kind="ghost" size="sm" href="/dashboard/orders">Open orders</Button>} /> : null}{getQuote.isError || createOrder.isError ? <ErrorNotice error={getQuote.error || createOrder.error} /> : null}</Tile>

    {domain.status === "transfer_pending" ? <Tile className="carbon-dashboard-panel"><div className="card-heading"><div><h2>Transfer status</h2><p>Query or act on a pending incoming/outgoing transfer.</p></div></div><div className="heading-actions">{["query", "approve", "reject", "cancel"].map((action) => <Button key={action} kind={action === "reject" || action === "cancel" ? "danger--ghost" : "secondary"} disabled={transferAction.isPending} onClick={() => setTransferConfirm(action)}>{action}</Button>)}</div>{transferAction.isError ? <ErrorNotice error={transferAction.error} /> : null}
      <Modal
        open={Boolean(transferConfirm)}
        danger={transferConfirm === "reject" || transferConfirm === "cancel"}
        modalHeading={transferConfirm ? `${transferConfirm} transfer` : "Transfer action"}
        primaryButtonText={transferAction.isPending ? "Working…" : "Continue"}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={transferAction.isPending}
        onRequestClose={() => setTransferConfirm(null)}
        onRequestSubmit={() => {
          if (!transferConfirm) return;
          transferAction.mutate(transferConfirm, { onSettled: () => setTransferConfirm(null) });
        }}
      >
        <p>Confirm <strong>{transferConfirm}</strong> for <strong>{domain.domain_name}</strong>.</p>
      </Modal>
    </Tile> : null}

    <DomainContacts domainId={domainId} />
    <Forwarding domainId={domainId} />
    <GlueHosts domainId={domainId} domainName={domain.domain_name} />
  </Shell>;
}

function AdminProviderPage() {
  const account = useQuery({ queryKey: ["provider-account"], queryFn: () => adminApi<{ environment: string; provider: Row }>("/provider/account") });
  const transactions = useQuery({ queryKey: ["provider-transactions"], queryFn: () => adminApi<{ provider: Row }>("/provider/transactions?limit=30") });
  const reconcile = useQuery({ queryKey: ["provider-reconcile"], queryFn: () => adminApi<{ reconciliation: Row }>("/provider/reconcile") });
  const provider = account.data?.provider || {};
  const transactionRows = Array.isArray(transactions.data?.provider?.items) ? transactions.data!.provider.items : [];
  return <AdminShell title="DomainNameAPI account" subtitle="Read-only provider balance, transaction history and local/provider reconciliation.">
    <Grid fullWidth className="carbon-dashboard-grid"><Column sm={4} md={4} lg={8}><Tile className="carbon-dashboard-panel"><h2>Provider balance</h2>{account.isPending ? <Loading /> : account.isError ? <ErrorNotice error={account.error} /> : <MetricGrid metrics={[["USD balance", formatMoney(provider.usdBalance || 0)], ["TRY balance", provider.tryBalance ?? "—"], ["Environment", account.data?.environment || "—"]]} />}</Tile></Column><Column sm={4} md={4} lg={8}><Tile className="carbon-dashboard-panel"><h2>Reconciliation</h2>{reconcile.isPending ? <Loading /> : reconcile.isError ? <ErrorNotice error={reconcile.error} /> : <pre className="khd-admin-tools-output">{JSON.stringify(reconcile.data?.reconciliation, null, 2)}</pre>}</Tile></Column></Grid>
    <Tile className="carbon-dashboard-panel carbon-table-section"><div className="card-heading"><div><h2>Provider transactions</h2><p>Read-only DomainNameAPI account activity.</p></div></div>{transactions.isPending ? <Loading /> : transactions.isError ? <ErrorNotice error={transactions.error} /> : <Table size="lg"><TableHead><TableRow><TableHeader>Date</TableHeader><TableHeader>Description</TableHeader><TableHeader>Amount</TableHeader><TableHeader>Currency</TableHeader><TableHeader>Status</TableHeader></TableRow></TableHead><TableBody>{transactionRows.map((item: Row, index: number) => <TableRow key={item.id || index}><TableCell>{formatDate(item.createdAt || item.transactionDate || item.date)}</TableCell><TableCell>{item.description || item.type || "transaction"}</TableCell><TableCell>{item.amount ?? item.price ?? "—"}</TableCell><TableCell>{item.currency || "USD"}</TableCell><TableCell><Badge value={item.status || "completed"} /></TableCell></TableRow>)}</TableBody></Table>}</Tile>
  </AdminShell>;
}

function AdminCronPage() {
  const query = useQuery({ queryKey: ["admin-cron"], queryFn: () => adminMonitorApi<{ cron: Row[] }>("/cron"), refetchInterval: 30000 });
  return <AdminShell title="Automation status" subtitle="Background domain jobs, schedules and latest execution state."><Tile className="carbon-dashboard-panel carbon-table-section">{query.isPending ? <Loading /> : query.isError ? <ErrorNotice error={query.error} /> : <Table size="lg"><TableHead><TableRow><TableHeader>Job</TableHeader><TableHeader>Schedule</TableHeader><TableHeader>Active</TableHeader><TableHeader>Status</TableHeader><TableHeader>Last run</TableHeader><TableHeader>Duration</TableHeader><TableHeader>Error</TableHeader></TableRow></TableHead><TableBody>{(query.data?.cron || []).map((item) => <TableRow key={item.jobname}><TableCell>{item.jobname}</TableCell><TableCell>{item.schedule}</TableCell><TableCell>{item.active ? "yes" : "no"}</TableCell><TableCell><Badge value={item.last_status || "never"} /></TableCell><TableCell>{formatDate(item.last_started_at)}</TableCell><TableCell>{item.last_duration_ms ? `${item.last_duration_ms} ms` : "—"}</TableCell><TableCell>{item.last_error_message || "—"}</TableCell></TableRow>)}</TableBody></Table>}</Tile></AdminShell>;
}

function AdminLogsPage() {
  const query = useQuery({ queryKey: ["provider-logs"], queryFn: () => adminApi<{ logs: Row[] }>("/provider/logs") });
  return <AdminShell title="Provider logs" subtitle="DomainNameAPI catalog and synchronization history."><Tile className="carbon-dashboard-panel carbon-table-section">{query.isPending ? <Loading /> : query.isError ? <ErrorNotice error={query.error} /> : <Table size="lg"><TableHead><TableRow><TableHeader>Type</TableHeader><TableHeader>Status</TableHeader><TableHeader>Date</TableHeader><TableHeader>Details</TableHeader></TableRow></TableHead><TableBody>{(query.data?.logs || []).map((item) => <TableRow key={item.id}><TableCell>{item.sync_type || "provider"}</TableCell><TableCell><Badge value={item.status} /></TableCell><TableCell>{formatDate(item.created_at)}</TableCell><TableCell><pre className="khd-admin-tools-output">{JSON.stringify(item.payload || item.error_message || {}, null, 2)}</pre></TableCell></TableRow>)}</TableBody></Table>}</Tile></AdminShell>;
}

function AdminTldsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["provider-tlds"], queryFn: () => adminApi<{ tlds: Row[] }>("/tlds") });
  const sync = useMutation({ mutationFn: () => adminApi("/tlds/sync", { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["provider-tlds"] }) });
  const toggle = useMutation({ mutationFn: ({ tld, enabled, popular }: { tld: string; enabled?: boolean; popular?: boolean }) => adminApi(`/tlds/${encodeURIComponent(tld)}`, { method: "PATCH", body: { enabled, popular } }), onSuccess: () => client.invalidateQueries({ queryKey: ["provider-tlds"] }) });
  return <AdminShell title="DomainNameAPI TLD catalog" subtitle="Exact provider costs, customer prices, periods, restore fees and required registry attributes."><Tile className="carbon-dashboard-panel carbon-table-section"><div className="card-heading"><div><h2>Catalog</h2><p>{query.data?.tlds?.length || 0} provider TLDs.</p></div><Button disabled={sync.isPending} onClick={() => sync.mutate()}>Sync production catalog</Button></div>{sync.isError ? <ErrorNotice error={sync.error} /> : null}{query.isPending ? <Loading /> : query.isError ? <ErrorNotice error={query.error} /> : <Table size="lg"><TableHead><TableRow><TableHeader>TLD</TableHeader><TableHeader>Sale</TableHeader><TableHeader>Registration</TableHeader><TableHeader>Renewal</TableHeader><TableHeader>Transfer</TableHeader><TableHeader>Restore</TableHeader><TableHeader>Periods</TableHeader><TableHeader>Attributes</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>{(query.data?.tlds || []).map((item) => <TableRow key={item.tld}><TableCell><strong>{item.tld}</strong><small className="dns-meta">{item.provider_product_name}</small></TableCell><TableCell><Badge value={item.enabled ? "enabled" : "disabled"} /></TableCell><TableCell>{formatMoney(item.registration_price_usd || 0)}<small className="dns-meta">cost {formatMoney(item.registration_cost_usd || 0)}</small></TableCell><TableCell>{formatMoney(item.renewal_price_usd || 0)}<small className="dns-meta">cost {formatMoney(item.renewal_cost_usd || 0)}</small></TableCell><TableCell>{formatMoney(item.transfer_price_usd || 0)}<small className="dns-meta">cost {formatMoney(item.transfer_cost_usd || 0)}</small></TableCell><TableCell>{item.restore_price_usd ? formatMoney(item.restore_price_usd) : "unsupported"}<small className="dns-meta">cost {item.restore_cost_usd ? formatMoney(item.restore_cost_usd) : "—"}</small></TableCell><TableCell>R: {(item.registration_periods || []).join(", ")}<br />N: {(item.renewal_periods || []).join(", ")}</TableCell><TableCell>{(item.provider_attributes || []).filter((x: Row) => x.isRequired).map((x: Row) => x.key).join(", ") || "none"}</TableCell><TableCell><div className="heading-actions"><Button kind="ghost" size="sm" onClick={() => toggle.mutate({ tld: item.tld, enabled: !item.enabled })}>{item.enabled ? "Disable" : "Enable"}</Button><Button kind="ghost" size="sm" onClick={() => toggle.mutate({ tld: item.tld, popular: !item.popular })}>{item.popular ? "Unfeature" : "Feature"}</Button></div></TableCell></TableRow>)}</TableBody></Table>}</Tile></AdminShell>;
}

export function NativePageRouter() {
  const current = route();
  if (!getSession()) {
    window.location.href = "/auth";
    return null;
  }
  if (!current) return null;
  if (current.kind === "notifications") return <NotificationsPage />;
  return <DomainManagePage domainId={current.domainId} />;
}
