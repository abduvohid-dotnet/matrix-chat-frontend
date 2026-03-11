import ReactDOM from "react-dom/client";
import { MatrixProvider } from "./app/providers/MatrixProvider";
import { App } from "./app/App";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <MatrixProvider>
    <App />
  </MatrixProvider>
);
