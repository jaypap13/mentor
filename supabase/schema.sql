-- Μονοπάτι — σχήμα βάσης δεδομένων για το Supabase.
--
-- Πώς το τρέχεις: Supabase → SQL Editor → New query → επικόλληση όλου του αρχείου → Run.
-- Μπορεί να ξανατρέξει χωρίς πρόβλημα (δεν σβήνει δεδομένα).
--
-- Ασφάλεια (Row Level Security): κάθε πίνακας είναι κλειδωμένος και ανοίγει μόνο
-- ό,τι ορίζουν οι κανόνες παρακάτω. Μη συνδεδεμένοι επισκέπτες δεν βλέπουν τίποτα.
--   • Στόχοι, χαλάρωση, συνημμένα: μόνο ο ιδιοκτήτης τους.
--   • Μηνύματα: μόνο αποστολέας και παραλήπτης.
--   • Προφίλ και φόρουμ: τα βλέπουν όλοι οι συνδεδεμένοι χρήστες.
--   • Learn (board 'a'): γράφουν μόνο μέντορες. Get involved (board 'b'): όλοι.
--   • Ο καθένας διαγράφει μόνο τις δικές του δημοσιεύσεις (μαζί φεύγουν και οι απαντήσεις τους).


-- ─────────────────────────────── Προφίλ ───────────────────────────────
-- Ένα προφίλ ανά λογαριασμό Google. Δημιουργείται στην πρώτη σύνδεση, όταν ο χρήστης
-- διαλέγει username, ρόλο, bio και φωτογραφία.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (char_length(btrim(username)) between 2 and 30),
  avatar text not null default '🙂' check (char_length(avatar) <= 16),
  photo_url text check (photo_url is null or char_length(photo_url) <= 1000),
  bio text not null default '' check (char_length(bio) <= 240),
  role text not null check (role in ('user', 'mentor')),
  created_at timestamptz not null default now()
);
-- Username μοναδικό χωρίς διάκριση πεζών/κεφαλαίων.
create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

-- Είναι ο τρέχων χρήστης μέντορας; (χρησιμοποιείται στους κανόνες ασφαλείας)
create or replace function public.is_mentor()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'mentor');
$$;


-- ─────────────────────────────── Στόχοι ───────────────────────────────
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null,
  estimated_total_duration text not null default '',
  status text not null default 'active' check (status in ('active', 'completed')),
  attachments jsonb not null default '[]'::jsonb, -- [{name, type, path}] — τα αρχεία είναι στο bucket goal-attachments
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists goals_user_idx on public.goals (user_id);

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null,
  estimated_duration text not null default '',
  position int not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'completed'))
);
create index if not exists milestones_goal_idx on public.milestones (goal_id);

create table if not exists public.subgoals (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.milestones (id) on delete cascade,
  goal_id uuid not null references public.goals (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null,
  difficulty text not null default 'easy' check (difficulty in ('easy', 'medium', 'hard')),
  position int not null,
  completed boolean not null default false,
  completed_at timestamptz,
  youtube_search_url text
);
create index if not exists subgoals_milestone_idx on public.subgoals (milestone_id);
create index if not exists subgoals_goal_idx on public.subgoals (goal_id);


-- ─────────────────────────── Συνεδρίες χαλάρωσης ───────────────────────────
create table if not exists public.relaxation_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  type text not null default 'breathing',
  technique text,
  context text not null default 'manual',
  created_at timestamptz not null default now()
);
create index if not exists relaxation_sessions_user_idx on public.relaxation_sessions (user_id);


-- ─────────────────────────────── Φόρουμ ───────────────────────────────
-- Οι απαντήσεις έχουν parent_id. Το board μιας απάντησης συμπληρώνεται αυτόματα από
-- τη δημοσίευση στην οποία απαντά. Φωτογραφία/βίντεο μόνο σε νέες δημοσιεύσεις του Learn.
create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  board text not null check (board in ('a', 'b')),
  parent_id uuid references public.forum_posts (id) on delete cascade,
  message text not null default '' check (char_length(message) <= 5000),
  category text not null default 'Γενικά',
  media_type text check (media_type in ('image', 'video')),
  media_path text, -- διαδρομή στο bucket forum-media
  created_at timestamptz not null default now(),
  constraint forum_posts_media_pair check ((media_type is null) = (media_path is null)),
  constraint forum_posts_media_only_learn check (media_path is null or (parent_id is null and board = 'a')),
  constraint forum_posts_not_empty check (btrim(message) <> '' or media_path is not null)
);
create index if not exists forum_posts_board_idx on public.forum_posts (board, created_at desc) where parent_id is null;
create index if not exists forum_posts_parent_idx on public.forum_posts (parent_id);
create index if not exists forum_posts_author_idx on public.forum_posts (author_id);

create or replace function public.forum_posts_inherit_board()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null then
    select p.board into new.board from public.forum_posts p where p.id = new.parent_id;
    if new.board is null then
      raise exception 'Η αρχική δημοσίευση δεν βρέθηκε.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists forum_posts_inherit_board on public.forum_posts;
create trigger forum_posts_inherit_board
  before insert on public.forum_posts
  for each row execute function public.forum_posts_inherit_board();


-- ─────────────────────────── Προσωπικά μηνύματα ───────────────────────────
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  text text not null check (btrim(text) <> '' and char_length(text) <= 4000),
  created_at timestamptz not null default now(),
  constraint messages_not_to_self check (sender_id <> recipient_id)
);
create index if not exists messages_pair_idx on public.messages (sender_id, recipient_id, created_at);
create index if not exists messages_recipient_idx on public.messages (recipient_id, created_at);


-- ─────────────────────────────── Αγαπημένα ───────────────────────────────
-- Δημοσιεύσεις με φωτογραφία/βίντεο που ο χρήστης έχει αποθηκεύσει με το αστεράκι.
-- Τα βλέπει μόνο ο ίδιος. Αν η δημοσίευση διαγραφεί, φεύγει και από τα αγαπημένα.
create table if not exists public.favorites (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  post_id uuid not null references public.forum_posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists favorites_user_idx on public.favorites (user_id, created_at desc);


-- ─────────────────────────── Διαγραφή λογαριασμού ───────────────────────────
-- Ο χρήστης διαγράφει τον δικό του λογαριασμό. Σβήνεται ο λογαριασμός σύνδεσης (το email
-- φεύγει από την εφαρμογή) και, αυτόματα, το προφίλ, οι στόχοι, η χαλάρωση, οι δημοσιεύσεις
-- και τα μηνύματά του. Τα αρχεία του τα σβήνει πρώτα το backend.
create or replace function public.delete_my_account()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Χρειάζεται σύνδεση.';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;


-- ─────────────────────────────── Δικαιώματα ───────────────────────────────
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.profiles, public.goals, public.milestones, public.subgoals,
  public.relaxation_sessions, public.forum_posts, public.messages, public.favorites
  to authenticated;
revoke all on
  public.profiles, public.goals, public.milestones, public.subgoals,
  public.relaxation_sessions, public.forum_posts, public.messages, public.favorites
  from anon;
revoke execute on function public.is_mentor() from public, anon;
grant execute on function public.is_mentor() to authenticated;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.milestones enable row level security;
alter table public.subgoals enable row level security;
alter table public.relaxation_sessions enable row level security;
alter table public.forum_posts enable row level security;
alter table public.messages enable row level security;
alter table public.favorites enable row level security;


-- ─────────────────────── Κανόνες ασφαλείας (RLS) ───────────────────────
-- Προφίλ
drop policy if exists "profiles: read by signed-in users" on public.profiles;
create policy "profiles: read by signed-in users" on public.profiles
  for select to authenticated using (true);
drop policy if exists "profiles: create own" on public.profiles;
create policy "profiles: create own" on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Στόχοι
drop policy if exists "goals: owner only" on public.goals;
create policy "goals: owner only" on public.goals
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "milestones: owner only" on public.milestones;
create policy "milestones: owner only" on public.milestones
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.goals g where g.id = goal_id and g.user_id = auth.uid()));

drop policy if exists "subgoals: owner only" on public.subgoals;
create policy "subgoals: owner only" on public.subgoals
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.milestones m where m.id = milestone_id and m.goal_id = subgoals.goal_id and m.user_id = auth.uid())
  );

-- Χαλάρωση
drop policy if exists "relaxation: owner only" on public.relaxation_sessions;
create policy "relaxation: owner only" on public.relaxation_sessions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Φόρουμ
drop policy if exists "forum: read by signed-in users" on public.forum_posts;
create policy "forum: read by signed-in users" on public.forum_posts
  for select to authenticated using (true);
drop policy if exists "forum: write (Learn only mentors)" on public.forum_posts;
create policy "forum: write (Learn only mentors)" on public.forum_posts
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (board = 'b' or public.is_mentor())
    and (media_path is null or media_path like auth.uid()::text || '/%')
  );
drop policy if exists "forum: delete own" on public.forum_posts;
create policy "forum: delete own" on public.forum_posts
  for delete to authenticated using (author_id = auth.uid());

-- Μηνύματα
drop policy if exists "messages: sender and recipient read" on public.messages;
create policy "messages: sender and recipient read" on public.messages
  for select to authenticated using (auth.uid() in (sender_id, recipient_id));
drop policy if exists "messages: send as self" on public.messages;
create policy "messages: send as self" on public.messages
  for insert to authenticated with check (sender_id = auth.uid());


-- ───────────────────────── Αρχεία (Storage) ─────────────────────────
-- Κάθε χρήστης ανεβάζει μόνο στον δικό του φάκελο: <user id>/<αρχείο>.
--   avatars           δημόσιο  — φωτογραφίες προφίλ (έως 5 MB)
--   forum-media       δημόσιο  — φωτογραφίες/βίντεο του Learn, μόνο μέντορες (έως 50 MB)
--   goal-attachments  ιδιωτικό — συνημμένα στόχων, μόνο ο ιδιοκτήτης (έως 20 MB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 5242880, array['image/*']),
  ('forum-media', 'forum-media', true, 52428800, array['image/*', 'video/*']),
  ('goal-attachments', 'goal-attachments', false, 20971520, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "monopati avatars: manage own" on storage.objects;
create policy "monopati avatars: manage own" on storage.objects
  for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "monopati forum-media: mentors upload own" on storage.objects;
create policy "monopati forum-media: mentors upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'forum-media' and (storage.foldername(name))[1] = auth.uid()::text and public.is_mentor());
drop policy if exists "monopati forum-media: read own" on storage.objects;
create policy "monopati forum-media: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'forum-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "monopati forum-media: delete own" on storage.objects;
create policy "monopati forum-media: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'forum-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "monopati goal-attachments: owner only" on storage.objects;
create policy "monopati goal-attachments: owner only" on storage.objects
  for all to authenticated
  using (bucket_id = 'goal-attachments' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'goal-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- Αγαπημένα: μόνο ο ιδιοκτήτης, και μόνο δημοσιεύσεις που έχουν φωτογραφία/βίντεο.
drop policy if exists "favorites: owner only" on public.favorites;
create policy "favorites: owner only" on public.favorites
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.forum_posts p where p.id = post_id and p.media_path is not null));


-- ─────────────────────────────── Συγκαταθέσεις ───────────────────────────────
create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('age_16', 'age_18', 'terms_privacy', 'health_data', 'ai_processing')),
  version text not null check (char_length(version) <= 40),
  granted boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists consents_user_idx on public.consents (user_id, kind, created_at desc);

grant select, insert on public.consents to authenticated;
revoke all on public.consents from anon;
alter table public.consents enable row level security;

drop policy if exists "consents: read own" on public.consents;
create policy "consents: read own" on public.consents
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "consents: insert own" on public.consents;
create policy "consents: insert own" on public.consents
  for insert to authenticated with check (user_id = auth.uid());


-- ─────────────────────── Διορθώσεις ασφαλείας ───────────────────────
-- Ίδιοι κανόνες με το security-fixes.sql: φωτογραφία μόνο από τον δικό σου φάκελο,
-- emoji χωρίς HTML χαρακτήρες, λινκ βημάτων μόνο αναζήτηση YouTube.
alter table public.profiles drop constraint if exists profiles_photo_url_own_avatar;
alter table public.profiles add constraint profiles_photo_url_own_avatar check (
  photo_url is null or (
    photo_url like 'https://mxdnlamhzglzdtkdwdum.supabase.co/storage/v1/object/public/avatars/' || id::text || '/%'
    and photo_url !~ '["''<>\s]'
  )
) not valid;
alter table public.profiles drop constraint if exists profiles_avatar_plain;
alter table public.profiles add constraint profiles_avatar_plain check (avatar !~ '[<>"''&]') not valid;
alter table public.subgoals drop constraint if exists subgoals_youtube_search_url_safe;
alter table public.subgoals add constraint subgoals_youtube_search_url_safe check (
  youtube_search_url is null or (
    youtube_search_url like 'https://www.youtube.com/results?%'
    and youtube_search_url !~ '["''<>\s]'
  )
) not valid;


-- ─────────────────────── Έγκριση μεντόρων ───────────────────────
-- Ίδιο με το mentor-verification.sql (εκεί και οδηγίες για το πώς εγκρίνεις μέντορα).
alter table public.profiles add column if not exists mentor_verified boolean not null default false;

-- Ο χρήστης δεν μπορεί να εγκρίνει τον εαυτό του: από την εφαρμογή (ή απευθείας με το
-- token του) η τιμή μένει όπως ήταν. Μόνο εσύ, από τον πίνακα ελέγχου της Supabase, την αλλάζεις.
-- Αν κάποιος πάψει να είναι μέντορας, η έγκριση χάνεται και χρειάζεται νέα.
create or replace function public.protect_mentor_verified()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  caller_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if caller_role in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.mentor_verified := false;
    elsif new.mentor_verified is distinct from old.mentor_verified then
      new.mentor_verified := old.mentor_verified;
    end if;
  end if;
  if new.role <> 'mentor' then
    new.mentor_verified := false;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_mentor_verified on public.profiles;
create trigger profiles_protect_mentor_verified
  before insert or update on public.profiles
  for each row execute function public.protect_mentor_verified();


-- ─────────────────── Learn: μόνο εγκεκριμένοι μέντορες ───────────────────
-- Ίδιο με το approved-mentors-only.sql (αντικαθιστά τους δύο κανόνες «μόνο μέντορες» πιο πάνω).
create or replace function public.is_verified_mentor()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'mentor' and mentor_verified);
$$;
revoke execute on function public.is_verified_mentor() from public, anon;
grant execute on function public.is_verified_mentor() to authenticated;

-- Δημοσιεύσεις και απαντήσεις στο Learn: μόνο εγκεκριμένοι μέντορες.
drop policy if exists "forum: write (Learn only mentors)" on public.forum_posts;
create policy "forum: write (Learn only mentors)" on public.forum_posts
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (board = 'b' or public.is_verified_mentor())
    and (media_path is null or media_path like auth.uid()::text || '/%')
  );

-- Ανέβασμα φωτογραφιών/βίντεο του Learn: μόνο εγκεκριμένοι μέντορες.
drop policy if exists "monopati forum-media: mentors upload own" on storage.objects;
create policy "monopati forum-media: mentors upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'forum-media' and (storage.foldername(name))[1] = auth.uid()::text and public.is_verified_mentor());
