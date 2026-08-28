import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { isNativePage, NativePageRouter } from "./native-pages";
import { DnsSettingsPage, isDnsSettingsPage } from "./dns-settings-page";
import { PlatformStatusBanner } from "./platform-status-banner";
import "./customer-domain-tools";
import { DomainCarbonExperience } from "./carbon-experience";
import { DomainApplicationShell } from "./domain-shell";
import "./styles.css";
import "./router-compat.css";
import "./platform-sync.css";
import "./carbon-product-alignment.scss";
import "./carbon-dns-alignment.scss";
import "./carbon-native-alignment.scss";
import "./carbon-customer-tools.scss";
import "./carbon-alignment.scss";
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
