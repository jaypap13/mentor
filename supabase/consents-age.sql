-- Mentor — ένδειξη ηλικίας 16–17 στις συγκαταθέσεις.
--
-- Πώς το τρέχεις: Supabase → SQL Editor → New query → επικόλληση όλου του αρχείου → Run.
-- Μπορεί να ξανατρέξει χωρίς πρόβλημα (δεν σβήνει δεδομένα).
--
-- Νέο είδος γραμμής στις συγκαταθέσεις:
--   • age_18   granted = true: ο χρήστης δήλωσε ότι είναι 18+.
--              granted = false: δήλωσε ότι είναι 16–17 (ανήλικος), άρα μια πληρωμένη
--              συνδρομή θα χρειαστεί συναίνεση γονέα.

alter table public.consents drop constraint if exists consents_kind_check;
alter table public.consents add constraint consents_kind_check
  check (kind in ('age_16', 'age_18', 'terms_privacy', 'health_data', 'ai_processing'));
