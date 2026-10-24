-- Let two signed-in operators authorize the same Facebook Page independently.
-- Jobs carry the operator ID so the worker always loads that operator's Page token.
alter table public.facebook_publisher_jobs drop constraint facebook_publisher_jobs_page_id_fkey;
alter table public.facebook_publisher_pages drop constraint facebook_publisher_pages_pkey;
alter table public.facebook_publisher_pages add constraint facebook_publisher_pages_pkey primary key (id, connected_by);
alter table public.facebook_publisher_jobs add column connected_by uuid not null references auth.users(id);
alter table public.facebook_publisher_jobs add constraint facebook_publisher_jobs_page_owner_fkey foreign key (page_id, connected_by) references public.facebook_publisher_pages(id, connected_by);
