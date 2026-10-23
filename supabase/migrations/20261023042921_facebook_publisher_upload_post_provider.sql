alter table public.facebook_publisher_internal add column if not exists upload_post_api_key_enc text;
alter table public.facebook_publisher_pages add column if not exists provider text not null default 'meta';
alter table public.facebook_publisher_pages add column if not exists profile_username text;
alter table public.facebook_publisher_pages add constraint facebook_publisher_pages_provider_check check (provider in ('meta','upload-post'));
alter table public.facebook_publisher_pages add constraint facebook_publisher_pages_profile_check check (provider <> 'upload-post' or profile_username is not null);
