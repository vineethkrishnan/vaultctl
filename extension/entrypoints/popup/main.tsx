// SPDX-License-Identifier: AGPL-3.0-or-later

import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Popup } from "./Popup";
import { i18nReady } from "./i18n";
import "@fontsource-variable/inter";
import "@fontsource-variable/geist-mono";
import "./style.css";

void i18nReady.then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Suspense fallback={null}>
        <Popup />
      </Suspense>
    </StrictMode>,
  );
});
