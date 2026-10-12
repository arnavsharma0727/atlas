-- The shared limiter's daily buckets are separate keys with a one-day window.
alter table public.public_endpoint_rate_limits
  drop constraint if exists public_endpoint_rate_limits_bucket_kind_check;

alter table public.public_endpoint_rate_limits
  add constraint public_endpoint_rate_limits_bucket_kind_check
  check (bucket_kind in ('client', 'global', 'client-day', 'global-day'));
