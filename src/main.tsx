import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { isNativePage, NativePageRouter } from "./native-pages";
import { DnsSettingsPage, isDnsSettingsPage } from "./dns-settings-page";
import { PlatformStatusBanner } from "./platform-status-banner";
import { DomainCarbonExperience } from "./carbon-experience";
import { DomainApplicationShell } from "./domain-shell";
import { initDomainI18n } from "./i18n";
// Carbon's emitted component CSS must load before every product-level override.
// The former legacy CSS layers targeted native inputs/buttons globally and were
// overriding Carbon React's field sizing, contrast and grid behavior.
import "./carbon-alignment.scss";
import "./carbon-product-alignment.scss";
import "./carbon-dns-alignment.scss";
import "./carbon-native-alignment.scss";
import "./carbon-theme-contrast-fixes.scss";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const isAuxiliaryNativeRoute = isNativePage();
const isDnsRoute = isDnsSettingsPage();

void initDomainI18n();

if (window.location.pathname.startsWith("/admin")) window.history.replaceState({}, "", "/");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DomainCarbonExperience>
      <QueryClientProvider client={queryClient}>
        <DomainApplicationShell>
          <PlatformStatusBanner />
          {isDnsRoute ? (
            <DnsSettingsPage />
          ) : isAuxiliaryNativeRoute ? (
            <NativePageRouter />
          ) : (
            <RouterProvider router={router} />
          )}
        </DomainApplicationShell>
      </QueryClientProvider>
    </DomainCarbonExperience>
  </React.StrictMode>,
);
