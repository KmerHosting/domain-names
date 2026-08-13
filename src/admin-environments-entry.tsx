import React from "react";
import ReactDOM from "react-dom/client";
import { AdminEnvironmentsPage } from "./admin-environments-page";
import "./styles.css";
import "./admin.css";
import "./router-compat.css";
import "./platform-sync.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><AdminEnvironmentsPage /></React.StrictMode>,
);
