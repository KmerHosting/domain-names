-- The legacy portal automation can create wallet-based renewal orders.
-- Only the direct DNA provisioning worker remains scheduled.
do $block$
begin
  begin perform cron.unschedule('domain-portal-automation'); exception when others then null; end;
end
$block$;
