# ⚡ Feedometer &mdash; Free Public RSS Tools Suite

Feedometer is a standalone, high-performance, zero-login suite of free RSS tools designed for public web utility and organic Google Search Engine Optimization (SEO).

## 🚀 The 2 Standalone Tools Included

1. **📖 Public RSS Viewer & Reader (`index.html` / `viewer.html`)**
   - Instant client-side RSS 2.0 and Atom 1.0 stream parser.
   - Executive Briefing Cards layout (Grid and Compact List views).
   - Reading modal popup and 1-click `🔄` metadata refresh button.
   - Quick preloaded popular feeds (Hacker News, The Verge, NYT World, NASA, ScienceDaily, BBC).

2. **🛠️ Public Web-to-RSS Builder (`builder.html`)**
   - Converts any blog, news website, or static webpage into a standard RSS 2.0 XML feed.
   - Automatically detects article titles, links, snippets, dates, and thumbnails from HTML semantics.
   - 1-click "Copy XML" and "Download `.xml`" export.

---

## 📁 Repository Structure

```text
feedometer/
├── index.html            # Main Landing & Tool 1: RSS Reader
├── viewer.html           # Alias redirect to RSS Reader
├── builder.html          # Tool 2: Web-to-RSS Generator
├── sitemap.xml           # Google / Bing Sitemap
├── robots.txt            # Search Engine Directive
├── manifest.json         # PWA Manifest
├── favicon.svg           # Brand Vector SVG Favicon
├── styles/
│   └── feedometer.css    # Responsive dark-theme styling
├── scripts/
│   ├── feedometer-viewer.js    # Standalone reader logic
│   └── feedometer-builder.js   # Standalone web-to-rss scraper
└── README.md
```

---

## 🔒 Zero-Leakage Privacy & Architecture
- **100% Client-Side / Zero-Login**: No authentication, no private databases, no user tracking.
- **Zero Leakage**: Completely isolated from internal enterprise modules (Slack, MS Teams, LinkedIn, LLM summaries, Stripe, Admin backend).
- **SEO & Search Indexing**: Full Schema.org JSON-LD structured data on all pages, OpenGraph tags, semantic HTML5, and valid `sitemap.xml`.

---

## 🌐 Deployment (Pages + Worker API)

The **static site** (HTML/CSS/JS) and the **API Worker** (`workers/feedometer-worker.js`) are deployed separately. Popular feeds stay fast only when the browser calls the Worker’s `/api/view` and the cron job warms that Worker’s edge cache.

### 1. Deploy the API Worker

From this folder:

```bash
npm install -g wrangler   # or use npx wrangler
wrangler login
wrangler deploy
```

After deploy, note your Worker URL (e.g. `https://feedometer-api.<account>.workers.dev`).

This project’s live API is `https://feedometer-api.feedometer.workers.dev`. Keep these in sync:

- `scripts/feedometer-config.js` → `PRODUCTION_API`
- `wrangler.toml` → `[vars] WORKER_PUBLIC_URL`
- Frontend API fallbacks → `https://feedometer-api.feedometer.workers.dev`

The Worker does not define a `DEFAULT_WORKER_PUBLIC_URL` constant. `WORKER_PUBLIC_URL`
identifies the API Worker. Browser-facing password-reset links use `APP_PUBLIC_URL`
(currently `https://feedometer-iyo.pages.dev`), so they always open the active Pages UI rather
than the API hostname. Set both values explicitly for every Worker deployment.

### Transactional email (Resend)

The Worker sends product email through the shared
`workers/services/email-service.js` boundary. The Resend API key is a Cloudflare
**secret**, never a value in `wrangler.toml`, frontend code, or GitHub.

1. In Resend, verify the sender domain (the current test sender is
   `FeedOmeter <noreply@mail.ev2rule.com>`).
2. In Cloudflare Worker **Settings → Variables and Secrets**, add
   `RESEND_API_KEY` as an encrypted secret.
3. Keep `MAIL_FROM` and `APP_PUBLIC_URL` in `[vars]` accurate for the current
   environment, then deploy the Worker.
4. Run `node test_resend_email_service.mjs` before deploying changes to the
   email service. This is a mocked contract test; it never sends an external
   email or exposes the real API key.

The first connected transactional flow is password reset. The user-facing API
always returns a generic success response, preventing email-address enumeration;
the reset token remains stored only as a hash in D1.

Optional waitlist (KV): create a namespace and uncomment `[[kv_namespaces]]` in `wrangler.toml`, then redeploy.

### Current development database workflow

FeedOmeter currently uses its configured Cloudflare D1 development database
directly. There is no local D1 or Miniflare runtime in this repository. Before
database changes, take an export/backup in Cloudflare, apply additive migrations
through Wrangler, and validate the changed routes against the deployed Worker.

`schema/schema_phase2.sql` is a **bootstrap-only** file because it contains
`DROP TABLE` statements. It must never be executed against the live database
as a routine migration. All new live schema changes belong in the numbered,
additive files under `schema/migrations/`.

Before applying a migration to the live database, follow
[`documents/phase-0-single-database-operations.md`](documents/phase-0-single-database-operations.md).
