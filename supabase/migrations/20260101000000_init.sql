-- Hollowmere schema (BUILD_PLAN section 10) + the LLM cache table the proxy needs.
-- Apply with:  supabase db push   (or locally: supabase db reset)
-- NOTE: written to the plan but NOT executed in the build sandbox (no Postgres available). See docs/VERIFY_M3.md.

create extension if not exists pgcrypto;

-- one row per anonymous or signed-in player (id = auth.users.id)
create table public.players (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  display_name text,
  settings jsonb not null default '{}'::jsonb
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  seed bigint not null,
  status text not null default 'active' check (status in ('active', 'ended', 'abandoned')),
  ending_family text
);
create index runs_player_idx on public.runs (player_id, created_at desc);

create table public.run_bibles (
  run_id uuid primary key references public.runs (id) on delete cascade,
  bible jsonb not null,
  created_at timestamptz not null default now()
);

create table public.story_seeds (
  run_id uuid primary key references public.runs (id) on delete cascade,
  seed_draw jsonb not null,
  onboarding_profile jsonb,
  created_at timestamptz not null default now()
);

create table public.saves (
  run_id uuid primary key references public.runs (id) on delete cascade,
  state jsonb not null,
  director_memory jsonb,
  updated_at timestamptz not null default now()
);

-- last 30 fingerprints per player feed the anti-repetition rule
create table public.fingerprints (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  run_id uuid not null references public.runs (id) on delete cascade,
  fingerprint jsonb not null,
  profile_key text not null default 'none',
  created_at timestamptz not null default now()
);
create index fingerprints_player_idx on public.fingerprints (player_id, created_at desc);

create table public.ghost_legends (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.runs (id) on delete set null,
  legend_text text not null,
  tags jsonb not null default '{}'::jsonb,
  monument_type text not null,
  created_at timestamptz not null default now()
);

create table public.daily_modifiers (
  day date primary key,
  modifier jsonb not null,
  created_at timestamptz not null default now()
);

-- every model call, including failed ones (they cost money)
create table public.llm_calls (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  day date not null default (now() at time zone 'utc')::date,
  player_id uuid,
  run_id uuid,
  prompt_id text not null,
  prompt_version text not null,
  model text not null,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  tokens_cached integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  latency_ms integer not null default 0,
  ok boolean not null,
  fallback_used boolean not null default false,
  error text
);
create index llm_calls_day_idx on public.llm_calls (day);
create index llm_calls_player_day_idx on public.llm_calls (player_id, day);
create index llm_calls_run_idx on public.llm_calls (run_id);

create table public.llm_cache (
  key text primary key,
  json jsonb not null,
  hits integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.content_gaps (
  gap text primary key,
  prompt_id text not null,
  count integer not null default 1,
  last_seen timestamptz not null default now()
);

-- single-row control panel: kill switch and daily budget cap
create table public.budget (
  id integer primary key default 1 check (id = 1),
  kill_switch boolean not null default false,
  daily_cap_usd numeric(10, 2) not null default 2.00,
  updated_at timestamptz not null default now()
);
insert into public.budget (id) values (1) on conflict do nothing;

-- spend dashboard: one row per day (read it in the Supabase Table Editor or SQL Editor)
create or replace view public.llm_spend_daily with (security_invoker = true) as
select
  day,
  count(*) as calls,
  count(*) filter (where not ok) as failed_calls,
  count(*) filter (where fallback_used) as fallbacks,
  sum(tokens_in) as tokens_in,
  sum(tokens_out) as tokens_out,
  sum(tokens_cached) as tokens_cached,
  round(sum(cost_usd)::numeric, 4) as cost_usd
from public.llm_calls
group by day
order by day desc;
revoke all on public.llm_spend_daily from anon, authenticated;

-- atomic counters used by the Edge Function (service role only)
create or replace function public.bump_content_gap(p_gap text, p_prompt text)
returns void language sql security definer set search_path = public as $$
  insert into public.content_gaps (gap, prompt_id) values (p_gap, p_prompt)
  on conflict (gap) do update set count = public.content_gaps.count + 1, last_seen = now();
$$;
create or replace function public.bump_cache_hit(p_key text)
returns void language sql security definer set search_path = public as $$
  update public.llm_cache set hits = hits + 1 where key = p_key;
$$;
revoke all on function public.bump_content_gap(text, text) from public, anon, authenticated;
revoke all on function public.bump_cache_hit(text) from public, anon, authenticated;

-- ───────────── row level security ─────────────
alter table public.players enable row level security;
alter table public.runs enable row level security;
alter table public.run_bibles enable row level security;
alter table public.story_seeds enable row level security;
alter table public.saves enable row level security;
alter table public.fingerprints enable row level security;
alter table public.ghost_legends enable row level security;
alter table public.daily_modifiers enable row level security;
alter table public.llm_calls enable row level security;
alter table public.llm_cache enable row level security;
alter table public.content_gaps enable row level security;
alter table public.budget enable row level security;

-- players: own row only
create policy players_select on public.players for select to authenticated using (id = auth.uid());
create policy players_insert on public.players for insert to authenticated with check (id = auth.uid());
create policy players_update on public.players for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- runs: own runs only
create policy runs_all on public.runs for all to authenticated using (player_id = auth.uid()) with check (player_id = auth.uid());

-- per-run tables: allowed when the run is the caller's
create policy run_bibles_all on public.run_bibles for all to authenticated
  using (exists (select 1 from public.runs r where r.id = run_id and r.player_id = auth.uid()))
  with check (exists (select 1 from public.runs r where r.id = run_id and r.player_id = auth.uid()));
create policy story_seeds_all on public.story_seeds for all to authenticated
  using (exists (select 1 from public.runs r where r.id = run_id and r.player_id = auth.uid()))
  with check (exists (select 1 from public.runs r where r.id = run_id and r.player_id = auth.uid()));
create policy saves_all on public.saves for all to authenticated
  using (exists (select 1 from public.runs r where r.id = run_id and r.player_id = auth.uid()))
  with check (exists (select 1 from public.runs r where r.id = run_id and r.player_id = auth.uid()));
create policy fingerprints_select on public.fingerprints for select to authenticated using (player_id = auth.uid());
create policy fingerprints_insert on public.fingerprints for insert to authenticated
  with check (player_id = auth.uid() and exists (select 1 from public.runs r where r.id = run_id and r.player_id = auth.uid()));

-- shared, read-only for players (written by the server with the service role)
create policy ghost_legends_read on public.ghost_legends for select to authenticated using (true);
create policy daily_modifiers_read on public.daily_modifiers for select to authenticated using (true);

-- llm_calls, llm_cache, content_gaps, budget: RLS on and NO policies => only the service role can touch them.
