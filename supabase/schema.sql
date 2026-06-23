-- The Pass community foundation.
-- Run this in a new Supabase project's SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  favorite_cuisine text default 'Surprise me',
  default_mood text default 'Anything',
  default_meal text default 'Any meal',
  default_servings text default 'Auto from ingredients',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  cuisine text,
  mood text,
  servings integer,
  serving_note text,
  ingredients jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  critic_rating numeric(2,1),
  critic_approved boolean not null default false,
  critic_verdict text,
  final_touches jsonb not null default '[]'::jsonb,
  public boolean not null default false,
  cookbook_consent boolean not null default false,
  cookbook_status text not null default 'not_eligible'
    check (cookbook_status in ('not_eligible', 'candidate', 'editorial_review', 'approved', 'published')),
  created_at timestamptz not null default now()
);

create table if not exists public.saved_recipes (
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  quote text not null check (char_length(quote) between 3 and 1000),
  photo_path text,
  status text not null default 'pending'
    check (status in ('pending', 'published', 'rejected')),
  created_at timestamptz not null default now(),
  unique (recipe_id, user_id)
);

alter table public.profiles enable row level security;
alter table public.recipes enable row level security;
alter table public.saved_recipes enable row level security;
alter table public.reviews enable row level security;

create policy "Public profiles are readable"
on public.profiles for select using (true);

create policy "Users create their profile"
on public.profiles for insert with check (auth.uid() = id);

create policy "Users update their profile"
on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "Public recipes are readable"
on public.recipes for select using (public or auth.uid() = creator_id);

create policy "Users create their recipes"
on public.recipes for insert with check (auth.uid() = creator_id);

create policy "Users update their recipes"
on public.recipes for update using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

create policy "Users read their saves"
on public.saved_recipes for select using (auth.uid() = user_id);

create policy "Users create their saves"
on public.saved_recipes for insert with check (auth.uid() = user_id);

create policy "Users remove their saves"
on public.saved_recipes for delete using (auth.uid() = user_id);

create policy "Published reviews are public"
on public.reviews for select using (status = 'published' or auth.uid() = user_id);

create policy "Users create their reviews"
on public.reviews for insert with check (auth.uid() = user_id);

create policy "Users update their reviews"
on public.reviews for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users remove their reviews"
on public.reviews for delete using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('plate-photos', 'plate-photos', true)
on conflict (id) do nothing;

create policy "Published plate photos are readable"
on storage.objects for select using (bucket_id = 'plate-photos');

create policy "Users upload their plate photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'plate-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users update their plate photos"
on storage.objects for update to authenticated
using (
  bucket_id = 'plate-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users delete their plate photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'plate-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

