# FeedOmeter

FeedOmeter is a personal RSS intelligence application. The browser UI is served
as static files and all persistent application data is owned by the SQL Server
API in `data-api/`.

## Architecture

- `data-api/` — Express API and SQL Server domain services.
- `schema/sql_server_complete_schema.sql` — SQL Server schema.
- `scripts/` and `*.html` — browser application.
- `server.js` — local static development server.

There is no D1 database. Cloudflare Worker edge services provide KV cache,
Browser Rendering, Workers AI, cron-triggered jobs, and Resend delivery while
SQL Server remains the sole system of record. Browser deployments must provide
the SQL API origin as `window.FEEDOMETER_SQL_API_ORIGIN` and may provide the
edge origin as `window.FEEDOMETER_EDGE_API_ORIGIN` before
`scripts/feedometer-config.js` loads; when static files and API share an
origin, no setting is required.

## Local development

1. Configure `data-api/.env` from `data-api/.env.example` with your SQL Server
   settings and a strong `JWT_SECRET`.
2. Start the API: `npm run start:api`.
3. Start the static app: `npm start`.
4. Run syntax verification: `npm run verify`.

The API health endpoint is available at `/health` and `/api/health`.
