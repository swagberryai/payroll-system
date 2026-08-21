import ErrorBoundary from './ErrorBoundary.jsx';
import React from "react";
import ReactDOM from "react-dom/client";
import PayrollFlowPrototype from "./payroll_flow_prototype.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary><PayrollFlowPrototype /></ErrorBoundary>
  </React.StrictMode>
);
