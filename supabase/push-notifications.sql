-- Mentor — ειδοποιήσεις στο κινητό (push, όπως στο Instagram).
--
-- Πώς το τρέχεις: Supabase → SQL Editor → New query → επικόλληση όλου του αρχείου → Run.
-- Μπορεί να ξανατρέξει χωρίς πρόβλημα (δεν σβήνει δεδομένα).
--
-- • push_subscriptions: κάθε συσκευή στην οποία ο χρήστης άνοιξε τις ειδοποιήσεις.
--   Τη βλέπει και την αλλάζει μόνο ο ίδιος.
-- • notification_settings: τι θέλει να του έρχεται (μηνύματα, απαντήσεις στο φόρουμ)
--   και ώρες ησυχίας. Τις βλέπει και τις αλλάζει μόνο ο ίδιος.
-- • push_targets_for_message / push_targets_for_reply: το backend ρωτά «σε ποιες συσκευές
--   να στείλω ειδοποίηση για αυτό που μόλις έστειλα;». Απαντούν μόνο στον αποστολέα, μόνο
--   για κάτι που έστειλε τα τελευταία 2 λεπτά, και σέβονται τις ρυθμίσεις του παραλήπτη.
--   Οι διευθύνσεις που επιστρέφουν δεν αρκούν για να σταλεί ειδοποίηση: χρειάζεται και το
--   μυστικό κλειδί VAPID, που υπάρχει μόνο στο backend.
-- Όταν διαγράφεται ο λογαριασμός, σβήνονται και αυτά αυτόματα.

create table if not exists public.push_subscriptions (
  endpoint text primary key check (char_length(endpoint) <= 1000 and endpoint like 'https://%'),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id, last_seen_at desc);

grant select, insert, update, delete on public.push_subscriptions to authenticated;
revoke all on public.push_subscriptions from anon;
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions: owner only" on public.push_subscriptions;
create policy "push_subscriptions: owner only" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.notification_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  messages boolean not null default true,
  forum_replies boolean not null default true,
  quiet_hours boolean not null default true,
  quiet_start smallint not null default 22 check (quiet_start between 0 and 23),
  quiet_end smallint not null default 8 check (quiet_end between 0 and 23),
  timezone text not null default 'Europe/Athens' check (char_length(timezone) <= 64),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.notification_settings to authenticated;
revoke all on public.notification_settings from anon;
alter table public.notification_settings enable row level security;
drop policy if exists "notification_settings: owner only" on public.notification_settings;
create policy "notification_settings: owner only" on public.notification_settings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Είναι τώρα «ώρες ησυχίας» για αυτόν τον χρήστη; (π.χ. 22 → 8 σημαίνει 22:00–07:59)
create or replace function public.push_is_quiet(p_user uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select ns.quiet_hours and ns.quiet_start <> ns.quiet_end and (
      case when ns.quiet_start < ns.quiet_end
        then h >= ns.quiet_start and h < ns.quiet_end
        else h >= ns.quiet_start or h < ns.quiet_end end)
    from public.notification_settings ns,
         lateral (select extract(hour from now() at time zone ns.timezone)::int as h) t
    where ns.user_id = p_user
  ), (select (h >= 22 or h < 8) from (select extract(hour from now() at time zone 'Europe/Athens')::int as h) d));
$$;
revoke all on function public.push_is_quiet(uuid) from public, anon, authenticated;

create or replace function public.push_targets_for_message(p_message_id uuid)
returns table (endpoint text, p256dh text, auth text)
language sql stable security definer
set search_path = ''
as $$
  select s.endpoint, s.p256dh, s.auth
  from public.messages m
  join public.push_subscriptions s on s.user_id = m.recipient_id
  left join public.notification_settings ns on ns.user_id = m.recipient_id
  where m.id = p_message_id
    and m.sender_id = auth.uid()
    and m.created_at > now() - interval '2 minutes'
    and coalesce(ns.messages, true)
    and not public.push_is_quiet(m.recipient_id)
    and s.last_seen_at > now() - interval '60 days'
  order by s.last_seen_at desc
  limit 10;
$$;
revoke all on function public.push_targets_for_message(uuid) from public, anon;
grant execute on function public.push_targets_for_message(uuid) to authenticated;

-- Απάντηση στο φόρουμ → ειδοποίηση σε αυτόν που έγραψε τη δημοσίευση (όχι αν απαντά στον εαυτό του).
create or replace function public.push_targets_for_reply(p_post_id uuid)
returns table (endpoint text, p256dh text, auth text)
language sql stable security definer
set search_path = ''
as $$
  select s.endpoint, s.p256dh, s.auth
  from public.forum_posts r
  join public.forum_posts p on p.id = r.parent_id
  join public.push_subscriptions s on s.user_id = p.author_id
  left join public.notification_settings ns on ns.user_id = p.author_id
  where r.id = p_post_id
    and r.author_id = auth.uid()
    and p.author_id <> r.author_id
    and r.created_at > now() - interval '2 minutes'
    and coalesce(ns.forum_replies, true)
    and not public.push_is_quiet(p.author_id)
    and s.last_seen_at > now() - interval '60 days'
  order by s.last_seen_at desc
  limit 10;
$$;
revoke all on function public.push_targets_for_reply(uuid) from public, anon;
grant execute on function public.push_targets_for_reply(uuid) to authenticated;

-- Αν η ίδια συσκευή χρησιμοποιηθεί από άλλο λογαριασμό (π.χ. αποσύνδεση χωρίς internet),
-- η συσκευή περνά στον λογαριασμό που είναι συνδεδεμένος τώρα.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language sql volatile security definer
set search_path = ''
as $$
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, last_seen_at = now();
$$;
revoke all on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
