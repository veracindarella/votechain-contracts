import { RequestHandler } from "express";
import helmet from "helmet";

/**
 * Value for the `Permissions-Policy` header.
 *
 * Every feature uses the empty allow-list `()` so it is disabled both for the
 * API origin itself and for any document that embeds it. The API only serves
 * JSON and the embeddable governance widget is a Web Component, so none of
 * these features are ever needed.
 */
export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "usb=()",
  "interest-cohort=()",
].join(", ");

// helmet 7 dropped its `permissionsPolicy` helper (the header is still not in
// its `HelmetOptions`), so it is set directly here.
const permissionsPolicy: RequestHandler = (_req, res, next) => {
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  next();
};

/**
 * Cross-origin isolation and feature-policy hardening, applied in addition to
 * the baseline helmet headers configured in `app.ts` (HSTS, frameguard,
 * noSniff, referrerPolicy):
 *
 *   - `Cross-Origin-Opener-Policy: same-origin` severs the `window.opener`
 *     relationship with cross-origin documents, blocking side-channel
 *     (e.g. Spectre-style) reads through an opened window.
 *   - `Cross-Origin-Embedder-Policy: require-corp` forces cross-origin
 *     subresources of our documents to opt in, which is what unlocks
 *     `crossOriginIsolated`.
 *   - `Permissions-Policy` disables browser features the API never needs.
 *
 * Widget-embed exception (documented in `docs/examples/governance-widget.md`):
 * the governance widget (`<votechain-proposals>`) is a Web Component that reads
 * `GET {api-url}/api/proposals` with a CORS-mode `fetch` — it is **not** loaded
 * in an `<iframe>`. COOP/COEP are only enforced on the *document* that
 * initiates a load, so they do not affect the widget, and
 * `Cross-Origin-Resource-Policy` (helmet's `same-origin` default) is only
 * evaluated for `no-cors` requests, so the CORS fetch keeps working even when
 * the host page itself sets `Cross-Origin-Embedder-Policy: require-corp`.
 * The one unsupported case is framing/navigating to an API URL as a *document*
 * — `require-corp` applies there, but the API only returns JSON, so no document
 * is meant to be embedded.
 */
export const securityHeaders: RequestHandler[] = [
  helmet.crossOriginOpenerPolicy({ policy: "same-origin" }),
  helmet.crossOriginEmbedderPolicy({ policy: "require-corp" }),
  permissionsPolicy,
];
