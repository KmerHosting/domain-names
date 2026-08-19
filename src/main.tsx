import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import AdminPage from "./admin";
import { isNativePage, NativePageRouter } from "./native-pages";
import { DnsSettingsPage, isDnsSettingsPage } from "./dns-settings-page";
import { AdminOperationsPage, isAdminOperationsPage } from "./admin-operations-page";
import { AdminEnvironmentsPage, isAdminEnvironmentsPage } from "./admin-environments-page";
import { PlatformStatusBanner } from "./platform-status-banner";
import { DomainCarbonExperience } from "./carbon-experience";
import { DomainApplicationShell } from "./domain-shell";
import "./styles.css";
import "./admin.css";
import "./router-compat.css";
import "./platform-sync.css";
import "./carbon-product-alignment.scss";
import "./carbon-dns-alignment.scss";
import "./carbon-native-alignment.scss";
import "./carbon-admin-alignment.scss";
import "./carbon-admin-console-alignment.scss";
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

const isAdminRoute = window.location.pathname === "/admin";
const isEnvironmentsRoute = isAdminEnvironmentsPage();
const isAuxiliaryNativeRoute = isNativePage();
const isDnsRoute = isDnsSettingsPage();
const isOperationsRoute = isAdminOperationsPage();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DomainCarbonExperience>
      <QueryClientProvider client={queryClient}>
        <DomainApplicationShell>
          <PlatformStatusBanner />
          {isEnvironmentsRoute ? (
            <AdminEnvironmentsPage />
          ) : isOperationsRoute ? (
            <AdminOperationsPage />
          ) : isDnsRoute ? (
            <DnsSettingsPage />
          ) : isAuxiliaryNativeRoute ? (
            <NativePageRouter />
          ) : isAdminRoute ? (
            <AdminPage />
          ) : (
            <RouterProvider router={router} />
          )}
        </DomainApplicationShell>
      </QueryClientProvider>
    </DomainCarbonExperience>
  </React.StrictMode>,
);
