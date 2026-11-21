# Embeddable Governance Widget

The VoteChain governance widget (`<votechain-proposals>`) is a zero-dependency Web Component
that lets any DAO website display live proposal data without building a frontend from scratch
and without requiring a wallet connection.

## Quick start

Build and host the widget bundle on a static HTTPS origin you control, then add
one script tag and one custom element to your HTML. The `votechain-widget`
package is not currently published to npm, so a jsDelivr URL will not work yet.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>My DAO — Governance</title>
</head>
<body>

  <votechain-proposals
    api-url="https://api.votechain.dev"
    theme="light"
    limit="5"
    filter-state="active">
  </votechain-proposals>

  <!-- Replace this URL with the location of your hosted build. -->
  <script src="https://static.example.org/votechain-widget.iife.js" defer></script>

</body>
</html>
```

## Attributes

| Attribute      | Type             | Default    | Description                                          |
|----------------|------------------|------------|------------------------------------------------------|
| `api-url`      | string (URL)     | —          | Base URL of the VoteChain API. **Required.**         |
| `theme`        | `light` \| `dark`| `light`    | Widget colour scheme.                                |
| `limit`        | number           | `5`        | Maximum number of proposals to display.              |
| `filter-state` | string           | `active`   | Filter by proposal state (`active`, `passed`, `rejected`, `executed`, `cancelled`). Pass `""` to show all states. |

Changing an observed attribute after the element is connected causes the widget
to rerender and fetch proposals again. For example:

```javascript
const widget = document.querySelector("votechain-proposals");
widget.setAttribute("filter-state", "passed");
widget.setAttribute("limit", "3");
```

## Examples

### Dark theme, 3 proposals, all states

```html
<votechain-proposals
  api-url="https://api.votechain.dev"
  theme="dark"
  limit="3"
  filter-state="">
</votechain-proposals>
```

### Self-hosted API

```html
<votechain-proposals
  api-url="https://governance.mydao.xyz"
  theme="light"
  limit="10"
  filter-state="active">
</votechain-proposals>
```

## CSS custom properties

You can further style the widget using CSS custom properties on the host element:

```css
votechain-proposals {
  --vc-bg: #f8f9fa;
  --vc-text: #212529;
  --vc-border: #dee2e6;
  --vc-card-bg: #ffffff;
  --vc-meta: #6c757d;
  --vc-badge-bg: #e9ecef;
  --vc-badge-text: #495057;
}
```

## Events and callbacks

The current widget does not dispatch custom DOM events and has no callback
attributes or JavaScript callback API. Loading, empty, and error states are
rendered inside the component. Do not rely on `onload`, `onerror`, or custom
event names; callback support requires a widget implementation change.

## Cross-origin requests (CORS)

The widget fetches `GET {api-url}/api/proposals` from the visitor's browser. If
the page and API have different origins, the API operator must include the
page's exact origin in the backend `ALLOWED_ORIGINS` environment variable. For
example:

```text
ALLOWED_ORIGINS=https://dao.example.org,https://www.dao.example.org
```

An origin includes the scheme, hostname, and non-default port, but no path or
trailing slash. The default backend configuration allows only
`http://localhost:5173`; production origins must be configured explicitly. The
widget sends a read-only request without credentials or an API key. Serve both
the page and API over HTTPS in production to avoid mixed-content blocking.

## Cross-origin isolation headers

The API also sends `Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Embedder-Policy: require-corp`, and a restrictive
`Permissions-Policy` (see `backend/src/middleware/securityHeaders.ts`). These do
not affect the widget: it is a Web Component, not an `<iframe>`, and it only
performs a CORS-mode `fetch`. COOP/COEP are enforced on the embedding
*document* rather than on a JSON response consumed by `fetch`, and
`Cross-Origin-Resource-Policy` is only evaluated for `no-cors` requests.
Host pages therefore do not need to change anything, and a host page that
itself sets `Cross-Origin-Embedder-Policy: require-corp` still loads the widget
because the CORS response satisfies its embedder policy check.

The one unsupported case is embedding or navigating to an API URL as a
document (for example `<iframe src="{api-url}/...">`): `require-corp` applies
there, but the API only returns JSON, so no document is meant to be embedded.

## Browser compatibility

The widget relies on Custom Elements v1, Shadow DOM v1, `fetch`,
`AbortController`, and CSS custom properties. These are conservative minimum
compatibility targets based on those platform APIs; this is not a claim that the
widget has been manually tested on every listed browser version.

| Browser | Compatibility target |
|---|---|
| Chrome / Chromium | 67 and later |
| Firefox | 63 and later |
| Safari on macOS | 13 and later |
| Safari on iOS | 13.4 and later |
| Microsoft Edge | 79 and later |
| Internet Explorer | Not supported |

## Building from source

The widget lives in `frontend/widget/` and is built with Vite:

```bash
cd frontend/widget
npm install
npm run build
# Output: frontend/widget/dist/votechain-widget.iife.js
```

The `iife` format produces a single self-contained JS file suitable for CDN distribution.

## No wallet required

The widget makes only read-only `GET` requests to the public API. No wallet connection,
no signing, no private keys needed.

## Demo status

The [HTML example](widget-example.html) is source code, not a hosted live demo.
The widget bundle is not published to npm, and this repository does not currently
provide a hosted demo URL. Publishing one requires a maintainer-controlled
GitHub Pages or CodeSandbox deployment and an API CORS allowlist entry for its
origin. Until then, build and serve the example locally as described above.
