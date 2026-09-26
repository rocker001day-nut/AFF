begin;
create table if not exists public.affiliate_accounts (
 id uuid primary key default gen_random_uuid(),
 platform text not null check (platform in ('shopee','lazada')),
 label text not null check (length(trim(label)) between 1 and 80),
 external_account_id text not null check (length(trim(external_account_id)) between 1 and 120),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 unique(platform,external_account_id)
);
alter table public.affiliate_accounts enable row level security;
drop policy if exists affiliate_accounts_read on public.affiliate_accounts;
create policy affiliate_accounts_read on public.affiliate_accounts for select to authenticated using (public.is_aff_team_member());
alter table public.import_batches add column if not exists account_id uuid references public.affiliate_accounts(id);
alter table public.affiliate_conversions add column if not exists account_id uuid references public.affiliate_accounts(id);
create index if not exists conversions_account_date_idx on public.affiliate_conversions(account_id,purchase_date_bkk);
create or replace function public.affiliate_dashboard(p_from date default null,p_to date default null,p_platform text default null,p_account uuid default null)
returns jsonb language sql stable security invoker set search_path=public as $$
with filtered as (
 select * from public.affiliate_conversions where
 (p_from is null or purchase_date_bkk >= p_from) and (p_to is null or purchase_date_bkk <= p_to)
 and (p_platform is null or platform=p_platform) and (p_account is null or account_id=p_account)
), valid as (select * from filtered where status_normalized not in ('cancelled','unpaid')),
totals as (
 select coalesce(sum(commission) filter(where platform='shopee'),0) shopee,
 coalesce(sum(commission) filter(where platform='lazada'),0) lazada,
 count(distinct (platform,account_id,coalesce(nullif(external_order_id,''),dedup_key))) orders,
 count(*) filter(where status_normalized in ('pending','unknown')) provisional_items from valid
), daily as (
 select purchase_date_bkk as day, sum(commission) revenue from valid group by 1 order by 1
), sup as (
 select coalesce(nullif(lower(trim(sub_id2)),''),'__no_sup__') sup_key,
 max(nullif(trim(sub_id2),'')) sub_id2,
 count(distinct (platform,account_id,coalesce(nullif(external_order_id,''),dedup_key))) orders,
 coalesce(sum(commission) filter(where platform='shopee'),0) shopee_commission,
 coalesce(sum(commission) filter(where platform='lazada'),0) lazada_commission,
 sum(commission) revenue from valid group by 1 order by revenue desc
), accounts as (
 select a.*, (select max(b.completed_at) from public.import_batches b where b.account_id=a.id and b.status='complete') last_import_at
 from public.affiliate_accounts a order by a.platform,a.label
)
select jsonb_build_object('totals',(select to_jsonb(totals) from totals),
 'daily',coalesce((select jsonb_agg(daily) from daily),'[]'::jsonb),
 'rows',coalesce((select jsonb_agg(sup) from sup),'[]'::jsonb),
 'accounts',coalesce((select jsonb_agg(accounts) from accounts),'[]'::jsonb),
 'excluded_items',(select count(*) from filtered where status_normalized in ('cancelled','unpaid')),
 'unassigned_items',(select count(*) from filtered where account_id is null));
$$;
revoke all on function public.affiliate_dashboard(date,date,text,uuid) from public,anon,authenticated;
grant execute on function public.affiliate_dashboard(date,date,text,uuid) to service_role;
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
    count(distinct (platform,account_id,coalesce(nullif(external_order_id,''), dedup_key))) filter (where status_normalized not in ('cancelled','unpaid')) as orders,
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


commit;
