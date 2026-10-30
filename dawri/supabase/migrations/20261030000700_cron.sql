-- Scheduled jobs: maintenance every 15 minutes and the evening summary check every 15 minutes.
-- Both call Edge Functions through pg_net, reading the project URL and service role key from Vault:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service-role-key>', 'service_role_key');
-- Skipped automatically where pg_cron is not installed (for example a plain local Postgres).
do $outer$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron/pg_net not available: cron jobs not registered';
    return;
  end if;

  create extension if not exists pg_cron;
  create extension if not exists pg_net;

  create or replace function public.call_edge_function(p_name text) returns bigint
  language plpgsql security definer set search_path = public as $fn$
  declare
    base text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
    key text := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key');
  begin
    if base is null or key is null then
      raise warning 'Vault secrets project_url / service_role_key are missing';
      return null;
    end if;
    return net.http_post(
      url := base || '/functions/v1/' || p_name,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000);
  end $fn$;
  revoke execute on function public.call_edge_function(text) from public, anon, authenticated;

  perform cron.unschedule(jobid) from cron.job where jobname in ('dawri-maintenance', 'dawri-daily-summary');
  perform cron.schedule('dawri-maintenance', '*/15 * * * *', 'select public.call_edge_function(''maintenance'')');
  perform cron.schedule('dawri-daily-summary', '1,16,31,46 * * * *', 'select public.call_edge_function(''daily-summary'')');
end $outer$;
