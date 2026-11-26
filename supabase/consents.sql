-- Mentor — συγκαταθέσεις χρηστών (GDPR).
--
-- Πώς το τρέχεις: Supabase → SQL Editor → New query → επικόλληση όλου του αρχείου → Run.
-- Μπορεί να ξανατρέξει χωρίς πρόβλημα (δεν σβήνει δεδομένα). Το ίδιο κομμάτι υπάρχει
-- και στο τέλος του schema.sql.
--
-- Κάθε φορά που ο χρήστης δίνει ή ανακαλεί μια συγκατάθεση γράφεται μια νέα γραμμή
-- (δεν αλλάζει και δεν σβήνεται καμία), ώστε να υπάρχει απόδειξη για το πότε δόθηκε και
-- σε ποια έκδοση των κειμένων. Ισχύει η πιο πρόσφατη γραμμή για κάθε είδος.
--   • age_16          Ο χρήστης δήλωσε ότι είναι 16 ετών ή μεγαλύτερος.
--   • terms_privacy   Αποδέχτηκε τους Όρους χρήσης και ενημερώθηκε από την Πολιτική απορρήτου.
--   • health_data     Ρητή συγκατάθεση για δεδομένα που αφορούν την ψυχική υγεία/ευεξία.
--   • ai_processing   Χρήση λειτουργιών AI (τα σχετικά δεδομένα πηγαίνουν στην Anthropic).
-- Όταν διαγράφεται ο λογαριασμός, σβήνονται και οι συγκαταθέσεις του.

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
