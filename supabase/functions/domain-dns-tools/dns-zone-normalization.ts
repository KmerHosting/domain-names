export type ProviderJson = Record<string, any>;

const clean = (value: unknown) => String(value ?? "").trim();
const lower = (value: unknown) => clean(value).toLowerCase();
const upper = (value: unknown) => clean(value).toUpperCase();

export function providerRecordList(payload: any): any[] | null {
  for (const candidate of [
    payload?.data?.records,
    payload?.records,
    payload?.data?.zones,
    payload?.zones,
    payload?.result?.records,
    payload?.result,
    payload?.data,
    payload,
  ]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
}

export function relativeProviderName(value: unknown, domainName: string) {
  const owner = lower(value || "@").replace(/\.$/, "") || "@";
  const zone = lower(domainName).replace(/\.$/, "");
  if (owner === "@" || owner === zone) return "@";
  if (owner.endsWith(`.${zone}`)) return owner.slice(0, -(zone.length + 1)) || "@";
  return owner;
}

export function normalizeProviderRecord(raw: ProviderJson, domainName: string) {
  const name = relativeProviderName(
    raw.name ?? raw.Name ?? raw.host ?? raw.recordName ?? "@",
    domainName,
  );
  const type = upper(raw.type ?? raw.Type ?? raw.recordType ?? raw.RecordType);
  const ttlValue = Number(raw.ttl ?? raw.TTL ?? 3600);
  const rawContents = Array.isArray(raw.contents)
    ? raw.contents
    : Array.isArray(raw.values)
      ? raw.values
      : Array.isArray(raw.records)
        ? raw.records
          .map((record: any) => typeof record === "string" ? record : record?.content)
          .filter((value: any) => value !== undefined)
        : [raw.content ?? raw.value ?? raw.target ?? raw.Record]
          .filter((value) => value !== undefined);
  const priorityValue = raw.priority ?? raw.Priority ?? raw.preference ?? null;
  const changeType = clean(raw.changeType ?? raw.ChangeType);
  const providerOperation = /delete|remove/i.test(changeType)
    ? "delete"
    : /add|create/i.test(changeType)
      ? "create"
      : /update|edit/i.test(changeType)
        ? "update"
        : "sync";
  return {
    name,
    type,
    ttl: Number.isFinite(ttlValue) ? ttlValue : 3600,
    contents: rawContents.map(clean).filter(Boolean),
    priority: priorityValue === null || priorityValue === undefined ? null : Number(priorityValue),
    metadata: { providerRaw: raw, providerChangeType: changeType },
    source: "provider",
    provider_record_id: clean(raw.id ?? raw.recordId ?? raw.zoneId) || null,
    status: changeType ? "pending" : "active",
    provider_operation: providerOperation,
    record_key: `${name.toLowerCase()}::${type}`,
  };
}
