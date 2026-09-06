import {
  Button,
  ComboBox,
  Header,
  HeaderContainer,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderMenuButton,
  HeaderMenuItem,
  HeaderName,
  HeaderNavigation,
  HeaderPanel,
  SideNav,
  SideNavDivider,
  SideNavItems,
  SideNavLink,
  SkipToContent,
} from "@carbon/react";
import {
  Application,
  Contrast,
  Dashboard,
  Help,
  Logout,
  Notification,
  Settings,
  UserAvatar,
} from "@carbon/react/icons";
import { ReactNode, useEffect, useState } from "react";
import { api, clearSession, getSession, subscribeSession, type Session, type User } from "./api";
import { useDomainTheme } from "./carbon-experience";
import { SiteFooter } from "./site-footer";
import { domainShellCopy, type DomainShellMessages } from "./domain-i18n";
import { isRtl, LOCALES, localeCookie, resolveLocale, type CommonMessages, type KmerLocale } from "@kmerhosting/i18n";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Dashboard;
  exact?: boolean;
};

type DomainCopy = DomainShellMessages & Pick<CommonMessages, "language" | "support" | "signIn" | "createAccount">;
type DomainMessageKey = keyof DomainShellMessages;

const CUSTOMER_DASHBOARD_URL = "https://domain.kmerhosting.com/dashboard";

const dashboardNavigation = [
  { href: "/dashboard", key: "overview" as DomainMessageKey, icon: Dashboard, exact: true },
  { href: "/dashboard/domains", key: "domains" as DomainMessageKey, icon: Application },
  { href: "/dashboard/orders", key: "orders" as DomainMessageKey, icon: Application },
  { href: "/dashboard/contacts", key: "contacts" as DomainMessageKey, icon: UserAvatar },
  { href: "/dashboard/invoices", key: "invoices" as DomainMessageKey, icon: Application },
  { href: "/dashboard/profile", key: "profile" as DomainMessageKey, icon: Settings },
] as const;

const publicNavigation = [
  { href: "/#search", key: "search" as DomainMessageKey },
  { href: "/#pricing", key: "pricing" as DomainMessageKey },
  { href: "/tlds", key: "allTlds" as DomainMessageKey },
  { href: "/#features", key: "features" as DomainMessageKey },
  { href: "/#hosting", key: "sharedHosting" as DomainMessageKey },
  { href: "/transfer-domain", key: "transfer" as DomainMessageKey },
] as const;

function useDomainSession() {
  const [session, setSession] = useState<Session | null>(() => getSession());
  useEffect(() => subscribeSession(() => setSession(getSession())), []);
  return session;
}

function isActivePath(item: NavItem, pathname: string) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function isPrivateShell(pathname: string) { return pathname.startsWith("/dashboard"); }

function browserLocale(): KmerLocale {
  const cookie = document.cookie.split("; ").find((value) => value.startsWith("kh_locale="))?.split("=")[1];
  return resolveLocale(cookie && decodeURIComponent(cookie), navigator.languages);
}

function NavigationLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const active = isActivePath(item, pathname);
  return (
    <SideNavLink
      href={item.href}
      isActive={active}
      aria-current={active ? "page" : undefined}
      renderIcon={Icon}
    >
      {item.label}
    </SideNavLink>
  );
}

export function DomainApplicationShell({ children }: { children: ReactNode }) {
  const { isDark, toggleTheme } = useDomainTheme();
  const session = useDomainSession();
  const pathname = window.location.pathname;
  const privateShell = isPrivateShell(pathname);
  const onCustomerDashboard = pathname.startsWith("/dashboard");
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [locale, setLocale] = useState<KmerLocale>(browserLocale);
  const copy = domainShellCopy(locale) as DomainCopy;
  const privateNavItems: NavItem[] = dashboardNavigation.map((item) => ({ ...item, label: copy[item.key] }));

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? "rtl" : "ltr";
  }, [locale]);

  const changeLocale = async (next: KmerLocale) => {
    setLocale(next);
    document.cookie = localeCookie(next, ".kmerhosting.com");
    if (session) await api("/me/language", { method: "PATCH", body: { locale: next } });
  };

  useEffect(() => {
    if (!session) {
      setUser(null);
      return;
    }
    let active = true;
    void api<{ user: User }>("/me")
      .then((payload) => { if (active) setUser(payload.user); })
      .catch(() => { if (active) setUser(null); });
    return () => { active = false; };
  }, [session?.expiresAt]);

  const logOut = async () => {
    await api<unknown>("/auth/logout", { method: "POST" }).catch(() => undefined);
    clearSession();
    window.location.assign("/");
  };

  return (
    <div className={privateShell ? "domain-app-shell domain-app-shell--private" : "domain-app-shell domain-app-shell--public"}>
      <HeaderContainer
        render={({ isSideNavExpanded, onClickSideNavExpand }) => (
          <>
            <Header aria-label={`KmerHosting ${copy.domains}`}>
              <SkipToContent href="#main-content" />
              <HeaderMenuButton
                aria-label={isSideNavExpanded ? copy.closeNavigation : copy.openNavigation}
                aria-expanded={isSideNavExpanded}
                aria-controls="domain-side-nav"
                isActive={isSideNavExpanded}
                onClick={onClickSideNavExpand}
              />
              <HeaderName href="/" prefix="KmerHosting">{copy.domains}</HeaderName>

              {!privateShell ? (
                <HeaderNavigation aria-label={`KmerHosting ${copy.domains}`}>
                  {publicNavigation.map((item) => <HeaderMenuItem key={item.href} href={item.href}>{copy[item.key]}</HeaderMenuItem>)}
                </HeaderNavigation>
              ) : null}

              <HeaderGlobalBar>
                <HeaderGlobalAction
                  aria-label={isDark ? copy.useLightTheme : copy.useDarkTheme}
                  tooltipAlignment="end"
                  onClick={toggleTheme}
                >
                  <Contrast size={20} />
                </HeaderGlobalAction>
                <HeaderGlobalAction
                  aria-label={copy.support}
                  tooltipAlignment="end"
                  onClick={() => { window.location.href = "mailto:support@kmerhosting.com?subject=KmerHosting%20Domains%20support"; }}
                >
                  <Help size={20} />
                </HeaderGlobalAction>
                {session ? (
                  <HeaderGlobalAction
                    aria-label={copy.notifications}
                    tooltipAlignment="end"
                    onClick={() => window.location.assign("/dashboard/notifications")}
                  >
                    <Notification size={20} />
                  </HeaderGlobalAction>
                ) : null}
                <HeaderGlobalAction
                  aria-label={copy.accountMenu}
                  aria-expanded={accountPanelOpen}
                  tooltipAlignment="end"
                  onClick={() => setAccountPanelOpen((open) => !open)}
                >
                  <UserAvatar size={20} />
                </HeaderGlobalAction>
              </HeaderGlobalBar>
            </Header>

            <HeaderPanel
              className="domain-header-panel"
              expanded={accountPanelOpen}
              aria-label={copy.accountMenu}
            >
              <div className="domain-header-panel__content">
                <div className="domain-header-panel__heading">
                  <h2>{session ? copy.domainAccount : "KmerHosting Account"}</h2>
                  <p>{session ? user?.email || copy.sessionActive : copy.centralAccess}</p>
                </div>
                <div className="domain-header-panel__actions">
                  <ComboBox
                    id="domain-language"
                    titleText={copy.language}
                    items={[...LOCALES]}
                    selectedItem={LOCALES.find((item) => item.code === locale) || LOCALES[0]}
                    itemToString={(item) => item ? `${item.flag} ${item.nativeLabel}` : ""}
                    onChange={({ selectedItem }) => { if (selectedItem) void changeLocale(selectedItem.code); }}
                  />
                  {session ? (
                    <>
                      {!onCustomerDashboard ? <Button kind="ghost" size="sm" href={CUSTOMER_DASHBOARD_URL} renderIcon={Dashboard}>{copy.customerDashboard}</Button> : null}
                      <Button kind="ghost" size="sm" href="https://dashboard.kmerhosting.com/?view=account" renderIcon={Settings}>{copy.centralAccount}</Button>
                      <Button kind="ghost" size="sm" renderIcon={Logout} onClick={() => void logOut()}>{copy.signOut}</Button>
                    </>
                  ) : (
                    <>
                      <Button kind="primary" size="sm" href="https://dashboard.kmerhosting.com/login?service=domain">{copy.signIn}</Button>
                      <Button kind="ghost" size="sm" href="https://dashboard.kmerhosting.com/register">{copy.createAccount}</Button>
                    </>
                  )}
                </div>
              </div>
            </HeaderPanel>

            <SideNav
              id="domain-side-nav"
              isRail={privateShell}
              expanded={isSideNavExpanded}
              isChildOfHeader
              aria-label={copy.navigation}
              className="domain-carbon-sidenav"
              onOverlayClick={isSideNavExpanded ? onClickSideNavExpand : undefined}
            >
              <SideNavItems>
                {privateShell ? <>
                  <p className="domain-sidenav-label">{copy.domains}</p>
                  {privateNavItems.slice(0, 3).map((item) => <NavigationLink key={item.href} item={item} pathname={pathname} />)}
                  <SideNavDivider />
                  <p className="domain-sidenav-label">{copy.account}</p>
                  {privateNavItems.slice(3).map((item) => <NavigationLink key={item.href} item={item} pathname={pathname} />)}
                  <SideNavLink href="/dashboard/notifications" isActive={pathname === "/dashboard/notifications"} aria-current={pathname === "/dashboard/notifications" ? "page" : undefined} renderIcon={Notification}>{copy.notifications}</SideNavLink>
                  <SideNavDivider />
                  <p className="domain-sidenav-label">{copy.connectedServices}</p>
                  <SideNavLink href="https://dashboard.kmerhosting.com/" renderIcon={Dashboard}>{copy.customerDashboard}</SideNavLink>
                </> : publicNavigation.map((item) => <SideNavLink key={item.href} href={item.href} isActive={pathname === item.href} aria-current={pathname === item.href ? "page" : undefined}>{copy[item.key]}</SideNavLink>)}
              </SideNavItems>
            </SideNav>
          </>
        )}
      />

      <div id="main-content" className="domain-content" tabIndex={-1}>
        {children}
      </div>
      {!privateShell ? <SiteFooter /> : null}
    </div>
  );
}
