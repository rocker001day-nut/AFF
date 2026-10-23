alter table public.facebook_publisher_internal add column if not exists meta_app_id text;
alter table public.facebook_publisher_internal add column if not exists meta_app_secret_enc text;
