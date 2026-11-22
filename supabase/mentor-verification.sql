-- Μονοπάτι — έγκριση μεντόρων.
--
-- Πώς το τρέχεις: Supabase → SQL Editor → New query → επικόλληση όλου του αρχείου → Run.
-- Μπορεί να ξανατρέξει χωρίς πρόβλημα. Δεν σβήνει δεδομένα.
-- ΣΗΜΑΝΤΙΚΟ: τρέξ' το ΠΡΙΝ ξεκινήσεις τον νέο server, αλλιώς το backend δεν βρίσκει τη στήλη.
--
-- Κάθε μέντορας ξεκινά «μη εγκεκριμένος» (κόκκινο Χ). Όταν τον εγκρίνεις, παίρνει πράσινο ✓.
--
-- Πώς εγκρίνεις έναν μέντορα:
--   Supabase → Table Editor → profiles → στη γραμμή του, στήλη mentor_verified → TRUE → Save.
--   ή στο SQL Editor:  update public.profiles set mentor_verified = true where lower(username) = lower('ΤΟ_USERNAME');
-- Για ανάκληση: το ίδιο, με false.

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
