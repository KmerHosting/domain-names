import {
  Column,
  GlobalTheme,
  Grid,
  Layer,
  SkeletonPlaceholder,
  SkeletonText,
  Theme,
  Tile,
} from "@carbon/react";
import {
  createContext,
  ReactNode,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

export type DomainTheme = "g10" | "g90";

type ThemeContextValue = {
  theme: DomainTheme;
  isDark: boolean;
  toggleTheme: () => void;
};

const THEME_STORAGE_KEY = "kmerhosting-domain-theme";
const THEME_EVENT = "kmerhosting-domain-theme-change";
const LOCATION_EVENT = "kmerhosting-domain-location-change";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function currentTheme(): DomainTheme {
  if (typeof window === "undefined") return "g10";
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "g10" || saved === "g90") return saved;
  if (saved === "white") return "g10";
  if (saved === "g100") return "g90";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "g90" : "g10";
}

function subscribeTheme(callback: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) callback();
  };
  const onTheme = () => callback();
  const onMedia = () => {
    if (!window.localStorage.getItem(THEME_STORAGE_KEY)) callback();
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_EVENT, onTheme);
  media.addEventListener("change", onMedia);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_EVENT, onTheme);
    media.removeEventListener("change", onMedia);
  };
}

function ensureHistoryEvents() {
  if (typeof window === "undefined") return;
  const scope = window as typeof window & { __kmerDomainHistoryPatched?: boolean };
  if (scope.__kmerDomainHistoryPatched) return;
  scope.__kmerDomainHistoryPatched = true;

  const pushState = window.history.pushState.bind(window.history);
  window.history.pushState = ((data: unknown, unused: string, url?: string | URL | null) => {
    pushState(data, unused, url);
    window.dispatchEvent(new Event(LOCATION_EVENT));
  }) as History["pushState"];

  const replaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState = ((data: unknown, unused: string, url?: string | URL | null) => {
    replaceState(data, unused, url);
    window.dispatchEvent(new Event(LOCATION_EVENT));
  }) as History["replaceState"];
}

function currentLocation() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function subscribeLocation(callback: () => void) {
  if (typeof window === "undefined") return () => undefined;
  ensureHistoryEvents();
  window.addEventListener("popstate", callback);
  window.addEventListener(LOCATION_EVENT, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(LOCATION_EVENT, callback);
  };
}

export function DomainLoadingScreen({ description = "Loading KmerHosting Domains" }: { description?: string }) {
  return (
    <div className="domain-loading-stage" aria-label={description} aria-live="polite" aria-busy="true">
      <div className="domain-loading-stage__underlay" aria-hidden="true" inert>
        <Layer>
          <div className="domain-loading-stage__header">
            <SkeletonPlaceholder className="domain-loading-stage__brand" />
            <SkeletonPlaceholder className="domain-loading-stage__action" />
          </div>
          <Grid fullWidth className="domain-loading-stage__grid">
            <Column sm={4} md={6} lg={10}>
              <SkeletonText heading width="48%" />
              <SkeletonText paragraph lineCount={2} width="76%" />
            </Column>
            {[0, 1, 2, 3].map((item) => <Column sm={2} md={2} lg={4} key={item}>
              <Tile className="domain-loading-stage__tile">
                <SkeletonText width="58%" />
                <SkeletonText heading width="44%" />
                <SkeletonText width="82%" />
              </Tile>
            </Column>)}
          </Grid>
        </Layer>
      </div>
    </div>
  );
}

export function DomainCarbonExperience({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => "g10" as DomainTheme);
  const locationKey = useSyncExternalStore(subscribeLocation, currentLocation, () => "/");

  useEffect(() => {
    document.documentElement.dataset.carbonTheme = theme;
    document.documentElement.style.colorScheme = theme === "g90" ? "dark" : "light";
  }, [theme]);

  const context = useMemo<ThemeContextValue>(() => ({
    theme,
    isDark: theme === "g90",
    toggleTheme: () => {
      const next: DomainTheme = theme === "g90" ? "g10" : "g90";
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      window.dispatchEvent(new Event(THEME_EVENT));
    },
  }), [theme]);

  return <ThemeContext.Provider value={context}>
    <GlobalTheme theme={theme}>
      <Theme theme={theme} className="domain-theme-root">
        <Suspense fallback={<DomainLoadingScreen />}>
          <div key={locationKey} className="domain-route-stage">{children}</div>
        </Suspense>
      </Theme>
    </GlobalTheme>
  </ThemeContext.Provider>;
}

export function useDomainTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useDomainTheme must be used inside DomainCarbonExperience");
  return value;
}
