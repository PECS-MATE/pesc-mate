import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import PromoDemo from "./promo/promo-demo";
import "bootstrap/dist/css/bootstrap-grid.min.css";
import "bootstrap/dist/css/bootstrap-utilities.min.css";
import "./assets/styles.css";
import "./assets/landing.css";
import "./assets/activityUx.css";
import "./assets/practiceUx.css";
import "./assets/responsiveUx.css";
import "./assets/speakingLibrary.css";
import "./promo/promo-demo.css";

const isPromoDemo = new URLSearchParams(window.location.search).get('promo') === 'demo';
if (isPromoDemo) document.documentElement.classList.add('promo-document');

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isPromoDemo ? <PromoDemo /> : <App />}
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
