import { FormEvent, useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  ApiClientError,
  api,
  formatMoney,
  getSession,
  newIdempotencyKey,
  orderGuardApi,
} from "./api";

type Row = Record<string, any>;
type PurchaseType = "registration" | "transfer";

type ProviderAttribute = {
  key: string;
  type?: string;
  options?: Array<{ value?: string } | string>;
  isRequired?: boolean;
  description?: string;
};

type TldPrice = {
  tld: string;
  registration_price_usd: number;
  transfer_price_usd: number;
  registration_periods?: number[];
  transfer_periods?: number[];
  provider_attributes?: ProviderAttribute[];
};

type SearchResult = {
  domainName: string;
  registrar: Row;
  price: TldPrice | null;
};

type Contact = {
  id: string;
  label?: string;
  first_name: string;
  last_name: string;
  email: string;
  is_default: boolean;
};

type OrderResponse = {
  order: {
    id: string;
    order_number: string;
    domain_name: string;
    price_usd: number;
    status: string;
  };
  quote?: Row;
};

function errorText(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return error instanceof Error ? error.message : "Request failed.";
}

function providerInfo(registrar: Row): Row {
  return registrar.info || registrar.data?.info || registrar.data || registrar;
}

function registrationAvailable(registrar: Row): boolean {
  const info = providerInfo(registrar);
  const raw = info.status ?? registrar.status ?? registrar.available ?? registrar.isAvailable;
  return ["available", "true", "free", "1"].includes(
    String(raw || "").toLowerCase().replace(/[\s_-]+/g, ""),
  );
}

function estimatedRegistrationPrice(result: SearchResult): number | null {
  if (!result.price) return null;
  const info = providerInfo(result.registrar);
  const premium = Boolean(info.isPremium ?? info.premium);
  const exactProviderCost = Number(info.price || 0);
  if (premium && Number.isFinite(exactProviderCost) && exactProviderCost > 0) {
    return Math.round(
      Math.max(exactProviderCost * 1.3, Number(result.price.registration_price_usd || 0)) * 100,
    ) / 100;
  }
  return Number(result.price.registration_price_usd || 0);
}

function contactLabel(contact: Contact): string {
  return contact.label || `${contact.first_name} ${contact.last_name}`;
}

function defaultNameservers(): string[] {
  return ["", ""];
}

function RegistryAttributes({
  definitions,
  values,
  onChange,
}: {
  definitions: ProviderAttribute[];
  values: Row;
  onChange: (next: Row) => void;
}) {
  if (!definitions.length) return null;
  return <section className="form-section">
    <h3>Registry information</h3>
    <p>These fields are defined by DomainNameAPI for this extension.</p>
    {definitions.map((definition) => {
      const options = (definition.options || [])
        .map((option) => typeof option === "string" ? option : String(option.value || ""))
        .filter(Boolean);
      const checkbox = definition.type === "Checkbox" || definition.type === "CheckboxWithContract";
      return <label key={definition.key}>
        {definition.description || definition.key}{definition.isRequired ? " *" : ""}
        {options.length ? <select
          value={String(values[definition.key] || "")}
          required={definition.isRequired}
          onChange={(event) => onChange({ ...values, [definition.key]: event.target.value })}
        >
          <option value="">Select</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select> : checkbox ? <input
          type="checkbox"
          checked={Boolean(values[definition.key])}
          required={definition.isRequired}
          onChange={(event) => onChange({ ...values, [definition.key]: event.target.checked })}
        /> : <input
          value={String(values[definition.key] || "")}
          required={definition.isRequired}
          onChange={(event) => onChange({ ...values, [definition.key]: event.target.value })}
        />}
      </label>;
    })}
  </section>;
}

export function isPurchasePage(pathname = window.location.pathname): boolean {
  return pathname === "/register-domain" || pathname === "/transfer-domain";
}

export function PurchasePageRouter() {
  const type: PurchaseType = window.location.pathname === "/transfer-domain" ? "transfer" : "registration";
  const initialDomain = useMemo(
    () => type === "registration" ? new URLSearchParams(window.location.search).get("domain") || "" : "",
    [type],
  );
  const [domainName, setDomainName] = useState(initialDomain);
  const [years, setYears] = useState(1);
  const [contactId, setContactId] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [useCustomNameservers, setUseCustomNameservers] = useState(false);
  const [nameservers, setNameservers] = useState<string[]>(defaultNameservers());
  const [attributes, setAttributes] = useState<Row>({});
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSession()) {
      const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
      window.location.href = `/auth?next=${next}`;
      return;
    }
    api<{ contacts: Contact[] }>("/contacts")
      .then((payload) => {
        const rows = payload.contacts || [];
        setContacts(rows);
        if (rows.length) setContactId((rows.find((contact) => contact.is_default) || rows[0]).id);
      })
      .catch((caught) => setError(errorText(caught)));
  }, []);

  const supportedPeriods = useMemo(() => {
    const values = type === "registration"
      ? result?.price?.registration_periods
      : result?.price?.transfer_periods;
    const normalized = Array.isArray(values)
      ? [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 10))]
      : [];
    return normalized.length ? normalized : [1];
  }, [result, type]);

  useEffect(() => {
    if (!supportedPeriods.includes(years)) setYears(supportedPeriods[0]);
  }, [supportedPeriods, years]);

  const checkDomain = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = domainName.trim().toLowerCase();
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const payload = await api<{ results: SearchResult[] }>("/domains/check", {
        method: "POST",
        body: { domains: [normalized] },
      });
      const next = payload.results?.[0] || null;
      if (!next) throw new Error("The provider did not return a result for this domain.");
      setDomainName(next.domainName);
      setResult(next);
      setAttributes({});
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setChecking(false);
    }
  };

  const canContinue = Boolean(
    result?.price &&
    contactId &&
    (type === "transfer" || registrationAvailable(result.registrar)),
  );

  const createOrder = async () => {
    if (!result?.price || !contactId) return;
    setCreating(true);
    setError(null);
    try {
      const body: Row = {
        domainName: result.domainName,
        years,
        contactId,
      };
      if (type === "transfer") body.authCode = authCode.trim();
      if (useCustomNameservers) body.nameServers = nameservers.map((value) => value.trim()).filter(Boolean);
      if (type === "registration") body.tldAttributes = attributes;

      const payload = await orderGuardApi<OrderResponse>(`/${type}`, {
        method: "POST",
        body,
        idempotencyKey: newIdempotencyKey(type),
      });
      sessionStorage.setItem(
        "khd-last-created-domain-order",
        JSON.stringify({
          orderNumber: payload.order.order_number,
          domainName: payload.order.domain_name,
          priceUsd: payload.order.price_usd,
        }),
      );
      window.location.href = "/dashboard/orders";
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setCreating(false);
    }
  };

  const price = type === "registration"
    ? result ? estimatedRegistrationPrice(result) : null
    : result?.price ? Number(result.price.transfer_price_usd || 0) : null;
  const provider = result ? providerInfo(result.registrar) : null;
  const premium = Boolean(provider?.isPremium ?? provider?.premium);

  return <main className="section">
    <div className="container purchase-layout">
      <div>
        <a className="back-link" href="/">← Domain search</a>
        <span className="kicker">{type === "registration" ? "Register domain" : "Transfer domain"}</span>
        <h1>{type === "registration" ? "Create a domain registration order" : "Transfer a domain to KmerHosting"}</h1>
        <p>
          Availability and exact pricing are checked before the order is created. Your balance is charged only when you pay the order.
        </p>
      </div>

      <section className="card">
        <form className="form-stack" onSubmit={checkDomain}>
          <label>Domain name
            <input
              value={domainName}
              onChange={(event) => {
                setDomainName(event.target.value);
                setResult(null);
              }}
              placeholder="example.com"
              required
            />
          </label>
          <button className="button button-secondary" disabled={checking}>
            {checking ? <><LoaderCircle className="spin" size={18} /> Checking DomainNameAPI…</> : type === "registration" ? "Check availability and pricing" : "Check transfer pricing"}
          </button>
        </form>

        {error && <div className="alert alert-error">{error}</div>}

        {result && <div className={type === "registration" && !registrationAvailable(result.registrar) ? "alert alert-error" : "alert alert-success"}>
          <strong>{result.domainName}</strong>{" "}
          {type === "registration"
            ? registrationAvailable(result.registrar)
              ? premium ? "is available as a premium domain." : "is available to register."
              : "is not available to register."
            : "is ready for the transfer eligibility check."}
          {price !== null && price > 0 && <> Estimated customer price: <strong>{formatMoney(price)}</strong>.</>}
          {premium && <span> The final order uses the exact premium quote returned by the provider.</span>}
        </div>}

        {result && result.price && (type === "transfer" || registrationAvailable(result.registrar)) && <div className="form-stack">
          <label>WHOIS contact
            <select value={contactId} onChange={(event) => setContactId(event.target.value)} required>
              <option value="">Select a contact</option>
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>
                {contactLabel(contact)} · {contact.email}
              </option>)}
            </select>
          </label>
          {!contacts.length && <div className="alert alert-warning">
            Create a complete WHOIS contact before ordering. <a href="/dashboard/contacts">Open contacts</a>.
          </div>}

          <label>Period
            <select value={years} onChange={(event) => setYears(Number(event.target.value))}>
              {supportedPeriods.map((period) => <option key={period} value={period}>
                {period} year{period === 1 ? "" : "s"}
              </option>)}
            </select>
          </label>

          {type === "transfer" && <label>EPP/auth code
            <input
              value={authCode}
              onChange={(event) => setAuthCode(event.target.value)}
              minLength={4}
              maxLength={35}
              required
              autoComplete="off"
            />
          </label>}

          <label>
            <input
              type="checkbox"
              checked={useCustomNameservers}
              onChange={(event) => setUseCustomNameservers(event.target.checked)}
            /> Use custom nameservers
          </label>

          {useCustomNameservers && <div className="form-stack">
            {nameservers.map((value, index) => <div className="dns-add-row" key={index}>
              <input
                value={value}
                onChange={(event) => setNameservers(
                  nameservers.map((item, position) => position === index ? event.target.value : item),
                )}
                placeholder={`ns${index + 1}.example.com`}
                required
              />
              <button
                type="button"
                className="button button-secondary"
                disabled={nameservers.length <= 2}
                onClick={() => setNameservers(nameservers.filter((_, position) => position !== index))}
              >Remove</button>
            </div>)}
            <button
              type="button"
              className="button button-secondary"
              disabled={nameservers.length >= 13}
              onClick={() => setNameservers([...nameservers, ""])}
            >Add nameserver</button>
          </div>}

          {type === "registration" && <RegistryAttributes
            definitions={result.price.provider_attributes || []}
            values={attributes}
            onChange={setAttributes}
          />}

          <button
            type="button"
            className="button button-primary"
            disabled={!canContinue || creating || type === "transfer" && authCode.trim().length < 4}
            onClick={createOrder}
          >
            {creating ? <><LoaderCircle className="spin" size={18} /> Creating protected quote…</> : "Create wallet order"}
          </button>
        </div>}
      </section>
    </div>
  </main>;
}
