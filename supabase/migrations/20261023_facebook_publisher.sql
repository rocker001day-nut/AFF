create extension if not exists pgcrypto with schema extensions;
create table if not exists public.facebook_publisher_pages (
  id text primary key check (id ~ '^[0-9]{5,30}$'),
  name text not null,
  access_token_enc text not null,
  connected_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.facebook_publisher_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  caption text not null default '',
  destination text not null,
  image_path text not null,
  delay_seconds integer not null check (delay_seconds between 5 and 3600),
  status text not null default 'draft' check (status in ('draft','queued','cancelled')),
  created_at timestamptz not null default now()
);
create table if not exists public.facebook_publisher_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.facebook_publisher_batches(id),
  page_id text not null references public.facebook_publisher_pages(id),
  scheduled_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','processing','posted','failed','uncertain')),
  attempts integer not null default 0,
  processing_started_at timestamptz,
  finished_at timestamptz,
  facebook_post_id text,
  permalink text,
  error text,
  unique(batch_id,page_id)
);
create index if not exists facebook_publisher_jobs_due_idx on public.facebook_publisher_jobs(scheduled_at) where status='queued';
create table if not exists public.facebook_publisher_internal (
  id integer primary key check(id=1),
  worker_token text not null
);
insert into public.facebook_publisher_internal(id,worker_token)
values (1, encode(extensions.gen_random_bytes(32),'hex')) on conflict (id) do nothing;
alter table public.facebook_publisher_pages enable row level security;
alter table public.facebook_publisher_batches enable row level security;
alter table public.facebook_publisher_jobs enable row level security;
alter table public.facebook_publisher_internal enable row level security;
revoke all on public.facebook_publisher_pages,public.facebook_publisher_batches,public.facebook_publisher_jobs,public.facebook_publisher_internal from anon,authenticated,public;
grant all on public.facebook_publisher_pages,public.facebook_publisher_batches,public.facebook_publisher_jobs,public.facebook_publisher_internal to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('aff-facebook-cards','aff-facebook-cards',true,8388608,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create or replace function public.facebook_claim_due_job()
returns setof public.facebook_publisher_jobs language sql security definer
set search_path = '' as $$
  update public.facebook_publisher_jobs j
  set status='processing', processing_started_at=now(), attempts=attempts+1
  where j.id = (
    select candidate.id from public.facebook_publisher_jobs candidate
    join public.facebook_publisher_batches b on b.id=candidate.batch_id
    where candidate.status='queued' and candidate.scheduled_at<=now() and b.status='queued'
    order by candidate.scheduled_at,candidate.id for update of candidate skip locked limit 1
  )
  returning j.*;
$$;
revoke all on function public.facebook_claim_due_job() from public,anon,authenticated;
grant execute on function public.facebook_claim_due_job() to service_role;
create table if not exists public.facebook_publisher_oauth_states(
  state text primary key,
  user_id uuid not null references auth.users(id),
  expires_at timestamptz not null default (now()+interval '10 minutes')
);
alter table public.facebook_publisher_oauth_states enable row level security;
revoke all on public.facebook_publisher_oauth_states from anon,authenticated,public;
grant all on public.facebook_publisher_oauth_states to service_role;