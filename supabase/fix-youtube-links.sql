-- Μονοπάτι — διόρθωση: βήματα που δεν έμεναν τσεκαρισμένα.
--
-- Πώς το τρέχεις: Supabase → SQL Editor → New query → επικόλληση όλου του αρχείου → Run.
-- Μπορεί να ξανατρέξει χωρίς πρόβλημα.
--
-- Γιατί: παλιά λινκ YouTube με απόστροφο (π.χ. «Γι' αυτό») δεν περνούσαν τον κανόνα ασφαλείας,
-- οπότε η βάση απέρριπτε κάθε αλλαγή σε αυτά τα βήματα (και το τσεκάρισμα).
-- Εδώ διορθώνονται τα παλιά λινκ και ο κανόνας ελέγχει πλέον και όλες τις παλιές γραμμές.

alter table public.subgoals drop constraint if exists subgoals_youtube_search_url_safe;

-- Η απόστροφος γίνεται %27 (το λινκ δουλεύει ακριβώς το ίδιο).
update public.subgoals
set youtube_search_url = replace(youtube_search_url, '''', '%27')
where youtube_search_url like '%''%';

-- Ό,τι δεν είναι καθαρή αναζήτηση YouTube σβήνεται (το βήμα μένει, χάνεται μόνο το λινκ).
update public.subgoals
set youtube_search_url = null
where youtube_search_url is not null
  and (youtube_search_url not like 'https://www.youtube.com/results?%' or youtube_search_url ~ '["''<>\s]');

alter table public.subgoals add constraint subgoals_youtube_search_url_safe check (
  youtube_search_url is null or (
    youtube_search_url like 'https://www.youtube.com/results?%'
    and youtube_search_url !~ '["''<>\s]'
  )
);
