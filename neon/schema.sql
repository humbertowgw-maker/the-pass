-- The Pass community schema for Neon Postgres.
-- Neon Auth owns the neon_auth schema. App records use its text user IDs.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id text primary key default (auth.user_id()),
  display_name text,
  favorite_cuisine text not null default 'Surprise me',
  default_mood text not null default 'Anything',
  default_meal text not null default 'Any meal',
  default_servings text not null default 'Auto from ingredients',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  creator_id text default (auth.user_id()),
  title text not null,
  description text,
  cuisine text,
  mood text,
  servings integer check (servings is null or servings > 0),
  serving_note text,
  ingredients jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  sous_notes jsonb not null default '[]'::jsonb,
  critic_rating numeric(2,1) check (critic_rating is null or critic_rating between 0 and 5),
  critic_approved boolean not null default false,
  critic_verdict text,
  final_touches jsonb not null default '[]'::jsonb,
  public boolean not null default false,
  cookbook_consent boolean not null default false,
  cookbook_status text not null default 'not_eligible'
    check (cookbook_status in ('not_eligible', 'candidate', 'editorial_review', 'approved', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipes_public_created_idx
  on public.recipes (public, created_at desc);

create table if not exists public.saved_recipes (
  user_id text not null default (auth.user_id()),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  user_id text not null default (auth.user_id()),
  rating integer not null check (rating between 1 and 5),
  title text,
  quote text not null check (char_length(quote) between 3 and 1000),
  recipe_snapshot jsonb,
  photo_url text,
  status text not null default 'pending'
    check (status in ('pending', 'published', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_id, user_id)
);

create index if not exists reviews_public_feed_idx
  on public.reviews (status, rating desc, created_at desc);

alter table public.reviews add column if not exists title text;
alter table public.reviews add column if not exists recipe_snapshot jsonb;
alter table public.profiles alter column user_id set default (auth.user_id());
alter table public.recipes alter column creator_id set default (auth.user_id());
alter table public.saved_recipes alter column user_id set default (auth.user_id());
alter table public.reviews alter column user_id set default (auth.user_id());

create or replace view public.cookbook_candidates
with (security_invoker = true) as
select
  r.id,
  r.title,
  r.description,
  r.cuisine,
  r.servings,
  r.critic_rating,
  count(v.id) filter (where v.status = 'published') as review_count,
  coalesce(avg(v.rating) filter (where v.status = 'published'), 0)::numeric(3,2) as community_rating
from public.recipes r
left join public.reviews v on v.recipe_id = r.id
where r.public
  and r.critic_approved
  and r.cookbook_consent
group by r.id
having count(v.id) filter (where v.status = 'published') >= 5
   and coalesce(avg(v.rating) filter (where v.status = 'published'), 0) >= 4.25;

alter table public.profiles enable row level security;
alter table public.recipes enable row level security;
alter table public.saved_recipes enable row level security;
alter table public.reviews enable row level security;

drop policy if exists manage_own_profile on public.profiles;
create policy manage_own_profile on public.profiles
for all to authenticated
using (auth.user_id() = user_id)
with check (auth.user_id() = user_id);

drop policy if exists read_public_recipes on public.recipes;
create policy read_public_recipes on public.recipes
for select to authenticated, anonymous
using (public = true);

drop policy if exists manage_own_recipes on public.recipes;
create policy manage_own_recipes on public.recipes
for all to authenticated
using (auth.user_id() = creator_id)
with check (auth.user_id() = creator_id);

drop policy if exists manage_own_saves on public.saved_recipes;
create policy manage_own_saves on public.saved_recipes
for all to authenticated
using (auth.user_id() = user_id)
with check (auth.user_id() = user_id);

drop policy if exists read_published_reviews on public.reviews;
create policy read_published_reviews on public.reviews
for select to authenticated, anonymous
using (status = 'published');

drop policy if exists manage_own_reviews on public.reviews;
create policy manage_own_reviews on public.reviews
for all to authenticated
using (auth.user_id() = user_id)
with check (auth.user_id() = user_id);

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.recipes to authenticated;
grant select, insert, update, delete on public.saved_recipes to authenticated;
grant select, insert, update, delete on public.reviews to authenticated;
grant select on public.cookbook_candidates to authenticated;
grant select on public.recipes to anonymous;
grant select on public.reviews to anonymous;
grant select on public.cookbook_candidates to anonymous;

-- Privacy-safe product analytics. This table intentionally stores no recipe
-- content, ingredients, email addresses, names, or account IDs.
create table if not exists public.generation_events (
  id uuid primary key default gen_random_uuid(),
  cook_hash text not null check (cook_hash ~ '^[a-f0-9]{64}$'),
  recipe_count integer not null default 4 check (recipe_count between 1 and 12),
  created_at timestamptz not null default now()
);

create index if not exists generation_events_created_at_idx
  on public.generation_events (created_at desc);
create index if not exists generation_events_cook_created_idx
  on public.generation_events (cook_hash, created_at);

alter table public.generation_events enable row level security;

drop policy if exists generation_events_insert_aggregate_only on public.generation_events;
create policy generation_events_insert_aggregate_only
on public.generation_events
for insert to anonymous, authenticated
with check (
  cook_hash ~ '^[a-f0-9]{64}$'
  and recipe_count between 1 and 12
);

revoke all on public.generation_events from anonymous, authenticated;
grant insert on public.generation_events to anonymous, authenticated;

create or replace function public.portfolio_generation_metrics()
returns table (
  recipes_generated_by_returning_cooks_weekly bigint,
  recipe_rounds_weekly bigint,
  recipes_generated_weekly bigint,
  active_cooks_weekly bigint,
  returning_cooks_weekly bigint,
  total_rounds bigint,
  latest_generation_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  with marked as (
    select
      event.id,
      event.cook_hash,
      event.recipe_count,
      event.created_at,
      exists (
        select 1
        from public.generation_events prior
        where prior.cook_hash = event.cook_hash
          and prior.created_at < event.created_at
      ) as is_returning
    from public.generation_events event
  )
  select
    coalesce(sum(recipe_count) filter (
      where created_at >= now() - interval '7 days' and is_returning
    ), 0)::bigint,
    count(*) filter (
      where created_at >= now() - interval '7 days'
    )::bigint,
    coalesce(sum(recipe_count) filter (
      where created_at >= now() - interval '7 days'
    ), 0)::bigint,
    count(distinct cook_hash) filter (
      where created_at >= now() - interval '7 days'
    )::bigint,
    count(distinct cook_hash) filter (
      where created_at >= now() - interval '7 days' and is_returning
    )::bigint,
    count(*)::bigint,
    max(created_at)
  from marked;
$$;

revoke all on function public.portfolio_generation_metrics() from public;
grant execute on function public.portfolio_generation_metrics()
  to anonymous, authenticated;
