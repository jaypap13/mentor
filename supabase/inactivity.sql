-- Mentor — αυτόματη διαγραφή λογαριασμών μετά από 24 μήνες αδράνειας (Πολιτική Απορρήτου, ενότητα 6).
--
-- Πώς το τρέχεις: Supabase → SQL Editor → New query → επικόλληση όλου του αρχείου → Run.
-- Μπορεί να ξανατρέξει χωρίς πρόβλημα (δεν σβήνει δεδομένα).
--
-- • last_active_at: πότε άνοιξε τελευταία φορά την εφαρμογή (το ενημερώνει το backend).
-- • inactivity_warned_at: πότε του στάλθηκε η προειδοποίηση των 30 ημερών. Μηδενίζεται μόλις
--   ξαναμπεί. Τη διαγραφή την κάνει το backend (backend/maintenance.js) μόνο αν έχουν περάσει
--   24 μήνες αδράνειας ΚΑΙ η προειδοποίηση στάλθηκε τουλάχιστον 30 ημέρες νωρίτερα.

alter table public.profiles add column if not exists last_active_at timestamptz not null default now();
alter table public.profiles add column if not exists inactivity_warned_at timestamptz;
create index if not exists profiles_last_active_idx on public.profiles (last_active_at);
