-- AFF Auto Sync phase 01 foundation
-- Run in Supabase SQL editor after reviewing the owner bootstrap statement at the bottom.

create extension if not exists pgcrypto;

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  person_code text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists team_members_email_lower_uidx on public.team_members (lower(email));

create table if not exists public.platform_connections (
  id uuid primary key default gen_random_uuid(),
  platform text not null unique check (platform in ('shopee','lazada','facebook')),
  account_label text,
  external_account_id text,
  status text not null default 'not_configured' check (status in ('not_configured','connected','expired','error','pending_approval')),
  connected_by uuid references auth.users(id),
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_credentials (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null unique references public.platform_connections(id) on delete cascade,
  access_token_enc text,
  refresh_token_enc text,
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  scopes text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('shopee','lazada','facebook','posts_registry')),
  source_file_name text,
  content_sha256 text not null,
  status text not null default 'processing' check (status in ('processing','complete','error')),
  row_count integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  unmatched_count integer not null default 0,
  parse_failed_count integer not null default 0,
  detected_mapping jsonb not null default '{}'::jsonb,
  error_message text,
  imported_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists import_batches_platform_hash_uidx on public.import_batches(platform, content_sha256);

create table if not exists public.affiliate_conversions (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('shopee','lazada')),
  source text not null default 'file' check (source in ('api','file','postback')),
  external_order_id text,
  external_item_id text,
  conversion_id text,
  purchase_time timestamptz,
  purchase_date_bkk date,
  status_raw text,
  status_normalized text not null default 'unknown' check (status_normalized in ('pending','completed','validated','cancelled','unpaid','unknown')),
  sub_id1 text,
  sub_id2 text,
  sub_id3 text,
  sub_id4 text,
  sub_id5 text,
  person_code text,
  subid2_parse_ok boolean not null default false,
  commission numeric(18,4) not null default 0,
  gmv numeric(18,4) not null default 0,
  dedup_key text not null,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  source_row_number integer,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform, dedup_key)
);
create index if not exists affiliate_conversions_sub2_idx on public.affiliate_conversions(lower(trim(sub_id2)));
create index if not exists affiliate_conversions_purchase_date_idx on public.affiliate_conversions(purchase_date_bkk);
create index if not exists affiliate_conversions_person_idx on public.affiliate_conversions(lower(person_code));

create table if not exists public.ad_spend_daily (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'facebook' check (source in ('facebook','manual')),
  spend_date date not null,
  sub_id2 text,
  person_code text,
  external_campaign_id text,
  external_adset_id text,
  external_ad_id text,
  spend numeric(18,4) not null default 0,
  currency text not null default 'THB',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source, spend_date, external_adset_id, external_ad_id, sub_id2)
);
create index if not exists ad_spend_daily_sub2_idx on public.ad_spend_daily(lower(trim(sub_id2)));

create table if not exists public.posts_registry (
  id uuid primary key default gen_random_uuid(),
  post_date date,
  sub_id1 text,
  sub_id2 text not null,
  sub_id5 text,
  person_code text,
  product_label text,
  shopee_url text,
  lazada_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sub_id2)
);

insert into public.platform_connections(platform, status)
values ('facebook','not_configured'), ('lazada','not_configured'), ('shopee','pending_approval')
on conflict (platform) do nothing;

alter table public.team_members enable row level security;
alter table public.platform_connections enable row level security;
alter table public.platform_credentials enable row level security;
alter table public.import_batches enable row level security;
alter table public.affiliate_conversions enable row level security;
alter table public.ad_spend_daily enable row level security;
alter table public.posts_registry enable row level security;

-- Helper: current authenticated user must be an active team member.
create or replace function public.is_aff_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.user_id = auth.uid() and tm.active = true
  );
$$;

revoke all on function public.is_aff_team_member() from public;
grant execute on function public.is_aff_team_member() to authenticated;

-- Recreate policies idempotently.
drop policy if exists team_members_read on public.team_members;
create policy team_members_read on public.team_members for select to authenticated using (public.is_aff_team_member());

drop policy if exists platform_connections_read on public.platform_connections;
create policy platform_connections_read on public.platform_connections for select to authenticated using (public.is_aff_team_member());

drop policy if exists import_batches_read on public.import_batches;
create policy import_batches_read on public.import_batches for select to authenticated using (public.is_aff_team_member());

drop policy if exists affiliate_conversions_read on public.affiliate_conversions;
create policy affiliate_conversions_read on public.affiliate_conversions for select to authenticated using (public.is_aff_team_member());

drop policy if exists ad_spend_daily_read on public.ad_spend_daily;
create policy ad_spend_daily_read on public.ad_spend_daily for select to authenticated using (public.is_aff_team_member());

drop policy if exists posts_registry_read on public.posts_registry;
create policy posts_registry_read on public.posts_registry for select to authenticated using (public.is_aff_team_member());

-- No authenticated policy is created for platform_credentials.
-- All writes to the new tables are intentionally server-side via service role.

create or replace view public.reconciliation_sup
with (security_invoker = true)
as
with revenue as (
  select
    coalesce(nullif(lower(trim(sub_id2)), ''), '__no_sup__') as sup_key,
    max(nullif(trim(sub_id2), '')) as sub_id2,
    max(coalesce(nullif(sub_id5,''), nullif(person_code,''))) as person_code,
    sum(case when platform = 'shopee' and status_normalized not in ('cancelled','unpaid') then commission else 0 end) as shopee_commission,
    sum(case when platform = 'lazada' and status_normalized not in ('cancelled','unpaid') then commission else 0 end) as lazada_commission,
    sum(case when platform = 'shopee' and status_normalized not in ('cancelled','unpaid') then gmv else 0 end) as shopee_gmv,
    sum(case when platform = 'lazada' and status_normalized not in ('cancelled','unpaid') then gmv else 0 end) as lazada_gmv,
    count(distinct coalesce(nullif(external_order_id,''), dedup_key)) filter (where status_normalized not in ('cancelled','unpaid')) as orders,
    count(*) filter (where status_normalized = 'cancelled') as cancelled
  from public.affiliate_conversions
  group by 1
), spend as (
  select
    coalesce(nullif(lower(trim(sub_id2)), ''), '__no_sup__') as sup_key,
    max(nullif(trim(sub_id2), '')) as sub_id2,
    max(nullif(person_code,'')) as person_code,
    sum(spend) as ad_spend
  from public.ad_spend_daily
  group by 1
), joined as (
  select
    coalesce(r.sup_key, s.sup_key) as sup_key,
    coalesce(r.sub_id2, s.sub_id2, 'ไม่มี SUP') as sub_id2,
    coalesce(r.person_code, s.person_code) as person_code,
    coalesce(r.shopee_commission, 0) as shopee_commission,
    coalesce(r.lazada_commission, 0) as lazada_commission,
    coalesce(r.shopee_gmv, 0) as shopee_gmv,
    coalesce(r.lazada_gmv, 0) as lazada_gmv,
    coalesce(r.orders, 0) as orders,
    coalesce(r.cancelled, 0) as cancelled,
    coalesce(s.ad_spend, 0) as ad_spend
  from revenue r
  full outer join spend s using (sup_key)
)
select
  sup_key,
  sub_id2,
  person_code,
  shopee_commission,
  lazada_commission,
  shopee_commission + lazada_commission as revenue,
  shopee_gmv,
  lazada_gmv,
  orders,
  cancelled,
  ad_spend,
  (shopee_commission + lazada_commission) - ad_spend as profit,
  case when ad_spend > 0 then (shopee_commission + lazada_commission) / ad_spend else null end as roas,
  case when ad_spend > 0 then (((shopee_commission + lazada_commission) - ad_spend) / ad_spend) * 100 else null end as roi_pct
from joined;

grant select on public.reconciliation_sup to authenticated;

-- IMPORTANT: bootstrap the first owner AFTER they have logged in at least once.
-- Replace BOTH placeholders, then run manually:
-- insert into public.team_members(email, user_id, role, person_code)
-- values ('OWNER_EMAIL', 'OWNER_AUTH_USER_UUID', 'owner', 'nut')
-- on conflict (user_id) do update set email = excluded.email, role = 'owner', person_code = excluded.person_code, active = true;
