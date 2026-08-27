import {
  Button,
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

type NavItem = {
  href: string;
  label: string;
  icon: typeof Dashboard;
  exact?: boolean;
};

const CUSTOMER_DASHBOARD_URL = "https://domain.kmerhosting.com/dashboard";

const dashboardNavigation: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: Dashboard, exact: true },
  { href: "/dashboard/domains", label: "Domains", icon: Application },
  { href: "/dashboard/orders", label: "Orders", icon: Application },
  { href: "/dashboard/contacts", label: "Contacts", icon: UserAvatar },
  { href: "/dashboard/invoices", label: "Invoices", icon: Application },
  { href: "/dashboard/profile", label: "Profile", icon: Settings },
];

function useDomainSession() {
  const [session, setSession] = useState<Session | null>(() => getSession());
  useEffect(() => subscribeSession(() => setSession(getSession())), []);
  return session;
}

function isActivePath(item: NavItem, pathname: string) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function isPrivateShell(pathname: string) { return pathname.startsWith("/dashboard"); }

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
            <Header aria-label="KmerHosting Domains">
              <SkipToContent href="#main-content" />
              {privateShell ? (
                <HeaderMenuButton
                  aria-label={isSideNavExpanded ? "Close navigation" : "Open navigation"}
                  aria-expanded={isSideNavExpanded}
                  aria-controls="domain-side-nav"
                  isActive={isSideNavExpanded}
                  onClick={onClickSideNavExpand}
                />
              ) : null}
              <HeaderName href="/" prefix="KmerHosting">Domains</HeaderName>

              {!privateShell ? (
                <HeaderNavigation aria-label="KmerHosting Domains">
                  <HeaderMenuItem href="/#search">Search</HeaderMenuItem>
                  <HeaderMenuItem href="/#pricing">Pricing</HeaderMenuItem>
                  <HeaderMenuItem href="/#features">Features</HeaderMenuItem>
                  <HeaderMenuItem href="/#hosting">Shared Hosting</HeaderMenuItem>
                  <HeaderMenuItem href="/transfer-domain">Transfer</HeaderMenuItem>
                </HeaderNavigation>
              ) : null}

              <HeaderGlobalBar>
                <HeaderGlobalAction
                  aria-label={isDark ? "Use light theme" : "Use dark theme"}
                  tooltipAlignment="end"
                  onClick={toggleTheme}
                >
                  <Contrast size={20} />
                </HeaderGlobalAction>
                <HeaderGlobalAction
                  aria-label="Support"
                  tooltipAlignment="end"
                  onClick={() => { window.location.href = "mailto:support@kmerhosting.com?subject=KmerHosting%20Domains%20support"; }}
                >
                  <Help size={20} />
                </HeaderGlobalAction>
                {session ? (
                  <HeaderGlobalAction
                    aria-label="Notifications"
                    tooltipAlignment="end"
                    onClick={() => window.location.assign("/dashboard/notifications")}
                  >
                    <Notification size={20} />
                  </HeaderGlobalAction>
                ) : null}
                <HeaderGlobalAction
                  aria-label="Account menu"
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
              aria-label="Account menu"
            >
              <div className="domain-header-panel__content">
                <div className="domain-header-panel__heading">
                  <h2>{session ? "Domain account" : "KmerHosting Account"}</h2>
                  <p>{session ? user?.email || "Your domain service session is active." : "Use your central account to access domain services."}</p>
                </div>
                <div className="domain-header-panel__actions">
                  {session ? (
                    <>
                      {!onCustomerDashboard ? <Button kind="ghost" size="sm" href={CUSTOMER_DASHBOARD_URL} renderIcon={Dashboard}>Customer dashboard</Button> : null}
                      <Button kind="ghost" size="sm" href="https://dashboard.kmerhosting.com/?view=account" renderIcon={Settings}>Central account</Button>
                      <Button kind="ghost" size="sm" renderIcon={Logout} onClick={() => void logOut()}>Sign out</Button>
                    </>
                  ) : (
                    <>
                      <Button kind="primary" size="sm" href="https://dashboard.kmerhosting.com/login?service=domain">Sign in</Button>
                      <Button kind="ghost" size="sm" href="https://dashboard.kmerhosting.com/register">Create account</Button>
                    </>
                  )}
                </div>
              </div>
            </HeaderPanel>

            {privateShell ? (
              <SideNav
                id="domain-side-nav"
                isRail
                expanded={isSideNavExpanded}
                isChildOfHeader
                aria-label="KmerHosting Domains navigation"
                className="domain-carbon-sidenav"
                onOverlayClick={isSideNavExpanded ? onClickSideNavExpand : undefined}
              >
                <SideNavItems>
                  {dashboardNavigation.slice(0, 3).map((item) => <NavigationLink key={item.href} item={item} pathname={pathname} />)}
                  <SideNavDivider />
                  {dashboardNavigation.slice(3).map((item) => <NavigationLink key={item.href} item={item} pathname={pathname} />)}
                  <SideNavDivider />
                  <SideNavLink href="/dashboard/notifications" isActive={pathname === "/dashboard/notifications"} aria-current={pathname === "/dashboard/notifications" ? "page" : undefined} renderIcon={Notification}>Notifications</SideNavLink>
                </SideNavItems>
              </SideNav>
            ) : null}
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
