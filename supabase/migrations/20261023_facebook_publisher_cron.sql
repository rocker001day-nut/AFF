create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.schedule('aff-facebook-publisher','5 seconds',$$
  select net.http_post(
    url := 'https://txbsrtunejnqaheuohck.supabase.co/functions/v1/facebook-publisher?action=worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-aff-worker-token',(select worker_token from public.facebook_publisher_internal where id=1)
    ),
    body := '{}'::jsonb
  )
  where exists (
    select 1 from public.facebook_publisher_jobs
    where status='queued' and scheduled_at<=now()
  );
$$);