# Phase 01 — completed in this package

- Preserved the original single-page dashboard and legacy `campaign_data` flow.
- Added **Auto Sync** navigation/page without removing Dashboard, AI Office, or Dorm.
- Added server API foundation with authenticated team membership checks.
- Added Supabase migration for:
  - `team_members`
  - `platform_connections`
  - `platform_credentials`
  - `import_batches`
  - `affiliate_conversions`
  - `ad_spend_daily`
  - `posts_registry`
  - `reconciliation_sup` view
- Added RLS read policies for active team members; credentials have no authenticated client policy.
- Added new Shopee/Lazada import endpoint that detects columns by header names, not fixed Excel letters.
- Added content-hash import dedup so the same file is not counted twice.
- Added per-row conversion dedup and whole-string `sub_id2` handling.
- Added resilient `sub_id2` parser with variable-length product prefix.
- Added SUP reconciliation API and UI.
- Added Vercel/server environment template with secrets kept server-side.
- Added automated tests for header mapping, SUP parsing, dedup identity, and validated status mapping.

## Still blocked by external setup / real samples

- Supabase migration must be applied to the live project.
- Owner must be added to `team_members` after login.
- `SUPABASE_SERVICE_ROLE_KEY` must be added to Vercel env.
- Exact Shopee/Lazada export headers still need a real sample to confirm mappings and whether legacy AE/W values are commission vs GMV.
- Facebook auto-pull needs a read-only Meta token + ad account ID (Phase 02).
- Lazada API path needs the account's actual Open API/Postback capability (Phase 03).
- Shopee API sync needs approved App ID/Secret and official schema confirmation (Phase 04).
