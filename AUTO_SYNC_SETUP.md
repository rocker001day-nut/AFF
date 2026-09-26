# Auto Sync — Phase 01 setup

This branch keeps the original `campaign_data` flow untouched and adds a separate server-backed foundation.

## 1) Supabase migration
Run `supabase/migrations/20260926_auto_sync_foundation.sql` in the Supabase SQL editor.

After the owner has logged into the website once, copy the owner's UUID from **Authentication > Users** and execute the owner bootstrap statement at the bottom of the migration file.

## 2) Vercel environment
Add these server-only variables to the Vercel project:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Do not put the service role key in `index.html` or any client-side file.

Future phases add `META_*`, `LAZADA_*`, and `SHOPEE_*` variables; placeholders are listed in `.env.example`.

## 3) Deploy preview
Deploy a Preview first. Check:

1. Existing Dashboard import still works.
2. Existing AI Office and Dorm pages still open.
3. Google login still works.
4. New **Auto Sync** page opens.
5. `/api/health` returns `{ ok: true }`.
6. Auto Sync status loads after login and owner bootstrap.
7. Upload the same supported Shopee/Lazada export twice; the second import must say it was already imported and must not double the data.

## 4) Mapping rule
The new importer intentionally uses **header names**, not fixed Excel letters. If the export header for purchase time or commission is unknown, it returns `mapping_required` and shows the detected headers instead of guessing.

This is deliberate until a real Shopee and Lazada export is available to confirm the exact header names and meaning of the legacy AE/W columns.
