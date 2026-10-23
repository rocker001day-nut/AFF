do $migration$
declare target_job bigint;
begin
  select jobid into target_job from cron.job where jobname = 'aff-facebook-publisher';
  if target_job is null then
    raise exception 'aff-facebook-publisher cron job is missing';
  end if;
  perform cron.alter_job(
    job_id := target_job,
    command := $job$
      select net.http_post(
        url := 'https://txbsrtunejnqaheuohck.supabase.co/functions/v1/facebook-publisher?action=worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-aff-worker-token', (select worker_token from public.facebook_publisher_internal where id=1)
        ),
        body := '{}'::jsonb
      )
      where exists (
        select 1 from public.facebook_publisher_jobs
        where status='queued' and scheduled_at<=now()
      ) or exists (
        select 1
        from public.facebook_publisher_jobs j
        join public.facebook_publisher_pages p on p.id=j.page_id
        where j.status='uncertain'
          and p.provider='upload-post'
          and j.finished_at<=now()-interval '30 seconds'
      );
    $job$
  );
end
$migration$;
