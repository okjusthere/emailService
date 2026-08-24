import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRoot } from "./app/AppRoot.js";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/composer.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>
);
