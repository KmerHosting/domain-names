import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import AdminPage from "./admin";
import "./styles.css";
import "./admin.css";
import "./runtime-fixes";
import "./domain-control-patches";
import "./provider-tools";
import "./notifications-panel";
import "./customer-domain-tools";
import "./transfer-page-fixes";
import "./admin-super-tools";

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {isAdminRoute ? <AdminPage /> : <RouterProvider router={router} />}
    </QueryClientProvider>
  </React.StrictMode>,
);
