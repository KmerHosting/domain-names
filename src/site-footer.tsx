import {
  Accordion,
  AccordionItem,
  Column,
  Grid,
  Link,
  Theme,
} from "@carbon/react";
import {
  LogoGithub,
  LogoLinkedin,
  LogoSlack,
  LogoX,
  LogoYoutube,
} from "@carbon/react/icons";
import "./site-footer.scss";

type FooterLink = { label: string; href: string };
type FooterGroup = { title: string; links: FooterLink[] };

function isExternalHref(href: string) {
  return /^https?:\/\//.test(href);
}

const footerGroups: FooterGroup[] = [
  {
    title: "Domains",
    links: [
      { label: "Search domains", href: "/#search" },
      { label: "Pricing", href: "/#pricing" },
      { label: "Transfer a domain", href: "/transfer-domain" },
      { label: "Customer dashboard", href: "/dashboard" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Central account", href: "https://dashboard.kmerhosting.com/?view=account" },
      { label: "Wallet", href: "/dashboard/wallet" },
      { label: "WHOIS contacts", href: "/dashboard/contacts" },
      { label: "Orders", href: "/dashboard/orders" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: "https://kmerhosting.com/docs" },
      { label: "System status", href: "https://status.kmerhosting.com" },
      { label: "KmerHosting", href: "https://kmerhosting.com" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About us", href: "https://kmerhosting.com/#about" },
      { label: "Contact", href: "mailto:hello@kmerhosting.com" },
      { label: "Careers", href: "mailto:hello@kmerhosting.com?subject=Careers" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "API reference", href: "https://kmerhosting.com/docs" },
      { label: "SDK", href: "https://github.com/kmerhosting/kmerhosting-sdk" },
      { label: "CLI", href: "https://github.com/kmerhosting/kmerhosting-cli" },
      { label: "MCP", href: "https://github.com/kmerhosting/kmerhosting-mcp" },
      { label: "GitHub", href: "https://github.com/kmerhosting" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "https://kmerhosting.com/privacy" },
      { label: "Terms", href: "https://kmerhosting.com/terms" },
      { label: "Refund", href: "https://kmerhosting.com/refund" },
      { label: "Cookies", href: "https://kmerhosting.com/cookies" },
      { label: "AI usage", href: "https://kmerhosting.com/ai-usage" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Technical support", href: "mailto:support@kmerhosting.com" },
      { label: "General inquiry", href: "mailto:hello@kmerhosting.com" },
    ],
  },
];

const footerColumns = [
  [footerGroups[0], footerGroups[4]],
  [footerGroups[1], footerGroups[5]],
  [footerGroups[2], footerGroups[3], footerGroups[6]],
];

const socialLinks = [
  { label: "GitHub", href: "https://github.com/kmerhosting", icon: LogoGithub },
  { label: "YouTube", href: "https://www.youtube.com/@kmerhosting", icon: LogoYoutube },
  { label: "Slack", href: "https://kmerhostingworkspace.slack.com", icon: LogoSlack },
  { label: "LinkedIn", href: "https://www.linkedin.com/company/kmerhosting", icon: LogoLinkedin },
  { label: "X", href: "https://x.com/kmerhosting", icon: LogoX },
];

function FooterLinks({ title, links }: FooterGroup) {
  return (
    <nav aria-label={`${title} links`}>
      <ul className="domain-site-footer__group-list">
        {links.map(({ label, href }) => {
          const external = isExternalHref(href);
          return (
            <li key={`${title}-${label}`}>
              <Link
                href={href}
                target={external ? "_blank" : undefined}
                rel={external ? "noreferrer" : undefined}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function FooterGroupBlock({ title, links }: FooterGroup) {
  return (
    <div className="domain-site-footer__group">
      <div className="domain-site-footer__group-desktop">
        <h2 className="domain-site-footer__group-title">{title}</h2>
        <FooterLinks title={title} links={links} />
      </div>
      <Accordion className="domain-site-footer__group-mobile" size="lg">
        <AccordionItem title={title}>
          <FooterLinks title={title} links={links} />
        </AccordionItem>
      </Accordion>
    </div>
  );
}

export function SiteFooter() {
  return (
    <Theme theme="g100">
      <footer className="domain-site-footer" aria-label="Footer">
        <div className="domain-site-footer__groups">
          <Grid fullWidth>
            <Column sm={4} md={8} lg={4} className="domain-site-footer__brand-column">
              <Link href="/" className="domain-site-footer__brand-link" aria-label="KmerHosting Domains home">
                <span className="domain-site-footer__brand-name">KmerHosting</span>
                <span className="domain-site-footer__brand-product">Domains</span>
              </Link>
              <p>Domain registration and management by KmerHosting LLC.</p>
            </Column>
            <Column sm={4} md={8} lg={12} className="domain-site-footer__navigation-column">
              <div className="domain-site-footer__group-columns">
                {footerColumns.map((groups, columnIndex) => (
                  <div className="domain-site-footer__group-stack" key={columnIndex}>
                    {groups.map((group) => <FooterGroupBlock key={group.title} {...group} />)}
                  </div>
                ))}
              </div>
            </Column>
          </Grid>
        </div>

        <div className="domain-site-footer__utility">
          <Grid fullWidth>
            <Column sm={4} md={8} lg={16}>
              <div className="domain-site-footer__utility-inner">
                <div className="domain-site-footer__bottom">
                  <span>© 2026 KmerHosting. All rights reserved.</span>
                  <Link href="https://kmerhosting.com/cookies" target="_blank" rel="noreferrer">Cookie settings</Link>
                </div>
                <div className="domain-site-footer__social-inner">
                  <span className="domain-site-footer__social-label">Follow KmerHosting</span>
                  <div className="domain-site-footer__socials" aria-label="Social links">
                    {socialLinks.map(({ label, href, icon: Icon }) => (
                      <Link key={label} href={href} target="_blank" rel="noreferrer" aria-label={`KmerHosting on ${label}`}>
                        <Icon size={20} aria-hidden="true" />
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </Column>
          </Grid>
        </div>
      </footer>
    </Theme>
  );
}
