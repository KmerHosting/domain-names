import fs from "node:fs";

const styles = fs.readFileSync(new URL("../src/carbon-alignment.scss", import.meta.url), "utf8");
const shell = fs.readFileSync(new URL("../src/domain-shell.tsx", import.meta.url), "utf8");

const checks = [
  [styles.includes(".domain-header-panel {\n  inline-size: 0;"), "collapsed HeaderPanel must be zero width"],
  [styles.includes(".domain-header-panel.cds--header-panel--expanded"), "expanded HeaderPanel override must be scoped to expanded state"],
  [shell.includes("isRail"), "authenticated SideNav must use Carbon rail behavior"],
  [shell.includes("isChildOfHeader"), "SideNav must use Carbon child-of-header positioning"],
  [shell.includes("<SideNavDivider"), "SideNav must group actions with Carbon dividers"],
  [styles.includes(".domain-carbon-sidenav"), "domain rail must have a scoped Carbon shell class"],
  [styles.includes("margin-inline-start: 3rem;"), "desktop content must reserve the collapsed rail width"],
  [styles.includes("domain-carbon-sidenav.cds--side-nav--expanded"), "expanded SideNav must have an explicit content layout state"],
  [styles.includes("margin-inline-start: 16rem;"), "expanded desktop SideNav must reserve 16rem"],
  [shell.includes("onOverlayClick={isSideNavExpanded ? onClickSideNavExpand : undefined}"), "mobile overlay close behavior must follow HeaderContainer state"],
  [shell.includes("<SkipToContent href=\"#main-content\" />"), "shell must expose Carbon SkipToContent"],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Carbon shell layout audit passed.");
