-- Mentor — στο Learn γράφουν (και ανεβάζουν φωτογραφίες/βίντεο) μόνο ΕΓΚΕΚΡΙΜΕΝΟΙ μέντορες.
--
-- Πώς το τρέχεις: Supabase → SQL Editor → New query → επικόλληση όλου του αρχείου → Run.
-- Μπορεί να ξανατρέξει χωρίς πρόβλημα. Χρειάζεται να έχει τρέξει πρώτα το mentor-verification.sql.
-- Το «Get involved» μένει ανοιχτό σε όλους.

-- Είναι ο τρέχων χρήστης εγκεκριμένος μέντορας;
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
