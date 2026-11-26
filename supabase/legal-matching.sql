-- Mentor — αλλαγές ώστε η εφαρμογή να κάνει ό,τι λένε οι Όροι και η Πολιτική Απορρήτου.
--
-- Πώς το τρέχεις: Supabase → SQL Editor → New query → επικόλληση όλου του αρχείου → Run.
-- Μπορεί να ξανατρέξει χωρίς πρόβλημα (δεν σβήνει δεδομένα).
--
-- 1. Διαγραφή λογαριασμού: οι αναρτήσεις του χρήστη στο Forum ΜΕΝΟΥΝ και εμφανίζονται ως
--    «Διαγραμμένος χρήστης» (author_id = null). Οι φωτογραφίες/βίντεο τους σβήνονται, και
--    όσες αναρτήσεις είχαν μόνο φωτογραφία/βίντεο (χωρίς κείμενο) σβήνονται ολόκληρες.
--    Προφίλ, στόχοι, μηνύματα, συγκαταθέσεις κ.λπ. σβήνονται όπως πριν.
-- 2. Αναφορές: κουμπί «Αναφορά» σε κάθε ανάρτηση. Οι αναφορές φαίνονται μόνο στον
--    διαχειριστή (Supabase → Table Editor → reports). Κανένας χρήστης δεν βλέπει αναφορές.

-- ── 1. Αναρτήσεις διαγραμμένων χρηστών ──
alter table public.forum_posts alter column author_id drop not null;
alter table public.forum_posts drop constraint if exists forum_posts_author_id_fkey;
alter table public.forum_posts add constraint forum_posts_author_id_fkey
  foreign key (author_id) references public.profiles (id) on delete set null;

create or replace function public.delete_my_account()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Χρειάζεται σύνδεση.';
  end if;
  -- Τα αρχεία τους τα έχει ήδη σβήσει το backend: αναρτήσεις μόνο με αρχείο φεύγουν,
  -- στις υπόλοιπες μένει μόνο το κείμενο.
  delete from public.forum_posts
    where author_id = auth.uid() and media_path is not null and btrim(message) = '';
  update public.forum_posts set media_path = null, media_type = null
    where author_id = auth.uid() and media_path is not null;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ── 2. Αναφορές ανάρμοστου περιεχομένου ──
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.forum_posts (id) on delete cascade,
  reporter_id uuid default auth.uid() references auth.users (id) on delete set null,
  reason text not null default '' check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
create unique index if not exists reports_once_per_user on public.reports (post_id, reporter_id);
create index if not exists reports_created_idx on public.reports (created_at desc);

grant insert on public.reports to authenticated;
revoke all on public.reports from anon;
alter table public.reports enable row level security;
drop policy if exists "reports: insert own" on public.reports;
create policy "reports: insert own" on public.reports
  for insert to authenticated with check (reporter_id = auth.uid());
