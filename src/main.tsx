import React from "react";
import ReactDOM from "react-dom/client";
import { MatrixProvider } from "./app/providers/MatrixProvider";
import { App } from "./app/App";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MatrixProvider>
      <App />
    </MatrixProvider>
  </React.StrictMode>
);