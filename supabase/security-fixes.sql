-- Μονοπάτι — διορθώσεις ασφαλείας (Νοέμβριος 2026).
--
-- Πώς το τρέχεις: Supabase → SQL Editor → New query → επικόλληση όλου του αρχείου → Run.
-- Μπορεί να ξανατρέξει χωρίς πρόβλημα. Δεν σβήνει και δεν αλλάζει δεδομένα.
--
-- Γιατί: ένας συνδεδεμένος χρήστης μπορεί να γράψει απευθείας στη βάση, παρακάμπτοντας
-- τον server. Αυτοί οι κανόνες εμποδίζουν να μπει κώδικας στη θέση της φωτογραφίας,
-- του emoji ή του λινκ YouTube. Το "not valid" σημαίνει: ισχύει για κάθε νέα αλλαγή,
-- χωρίς να ελέγξει τις παλιές γραμμές (ώστε να μην αποτύχει αν υπάρχει κάτι παλιό).

-- Φωτογραφία προφίλ: μόνο από τον φάκελο του ίδιου του χρήστη στο bucket "avatars".
alter table public.profiles drop constraint if exists profiles_photo_url_own_avatar;
alter table public.profiles add constraint profiles_photo_url_own_avatar check (
  photo_url is null or (
    photo_url like 'https://mxdnlamhzglzdtkdwdum.supabase.co/storage/v1/object/public/avatars/' || id::text || '/%'
    and photo_url !~ '["''<>\s]'
  )
) not valid;

-- Emoji avatar: χωρίς χαρακτήρες που χρησιμοποιούνται σε HTML.
alter table public.profiles drop constraint if exists profiles_avatar_plain;
alter table public.profiles add constraint profiles_avatar_plain check (avatar !~ '[<>"''&]') not valid;

-- Λινκ «Σχετικά βίντεο στο YouTube» των βημάτων: μόνο αναζήτηση στο YouTube.
alter table public.subgoals drop constraint if exists subgoals_youtube_search_url_safe;
alter table public.subgoals add constraint subgoals_youtube_search_url_safe check (
  youtube_search_url is null or (
    youtube_search_url like 'https://www.youtube.com/results?%'
    and youtube_search_url !~ '["''<>\s]'
  )
) not valid;
