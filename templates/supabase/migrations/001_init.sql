-- 001_init — full schema for {{brand.name}}
-- events + subscribers + bookings, RPCs (book_event, cancel_booking,
-- event_availability), the Brevo-sync trigger, RLS, grants and seed data.
-- Single source of truth — generated from site.config.json.

create extension if not exists pgcrypto;
create extension if not exists pg_net;

-- ── events ─────────────────────────────────────────────────────────────────
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  event_date    date not null,
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  capacity      integer not null default {{booking.capacity}} check (capacity >= 0),
  booked_count  integer not null default 0 check (booked_count >= 0),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint events_booked_within_capacity check (booked_count <= capacity)
);

-- ── subscribers ──────────────────────────────────────────────────────────--
create table if not exists public.subscribers (
  name             text,
  email            text not null,
  active           boolean not null default true,
  source           text not null default 'newsletter' check (source in ('newsletter','booking')),
  subscribed_at    timestamptz not null default now(),
  unsubscribed_at  timestamptz,
  id               uuid primary key default gen_random_uuid(),
  constraint subscribers_email_lower check (email = lower(email)),
  constraint subscribers_email_unique unique (email)
);
create index if not exists subscribers_active_idx on public.subscribers (active) where active = true;

-- ── bookings ─────────────────────────────────────────────────────────────--
create table if not exists public.bookings (
  status        text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  event_date    date not null,
  email         text not null,
  name          text,
  betrag        integer not null check (betrag >= 0),
  promo_code    text,
  newsletter    boolean not null default false,
  cancelled_at  timestamptz,
  booked_at     timestamptz not null default now(),
  cancel_token  text not null unique default encode(gen_random_bytes(24), 'hex'),
  event_id      uuid not null references public.events(id),
  id            uuid primary key default gen_random_uuid(),
  constraint bookings_email_lower check (email = lower(email)),
  constraint bookings_no_double_confirmed unique (event_id, email, status)
);
create index if not exists bookings_event_idx  on public.bookings (event_id);
create index if not exists bookings_email_idx  on public.bookings (lower(email));
create index if not exists bookings_status_idx on public.bookings (status);

-- ── RLS ──────────────────────────────────────────────────────────────────--
alter table public.events      enable row level security;
alter table public.subscribers enable row level security;
alter table public.bookings    enable row level security;

drop policy if exists "public read active events" on public.events;
create policy "public read active events" on public.events
  for select to anon, authenticated using (is_active = true);

-- subscribers: anon may insert (signup), update (unsubscribe), select (idempotency check).
-- No sensitive columns — abuse is handled by Netlify edge rate-limiting, not RLS.
drop policy if exists "anon insert subscribers" on public.subscribers;
create policy "anon insert subscribers" on public.subscribers
  for insert to anon with check (true);
drop policy if exists "anon update subscribers" on public.subscribers;
create policy "anon update subscribers" on public.subscribers
  for update to anon using (true) with check (true);
drop policy if exists "anon select subscribers" on public.subscribers;
create policy "anon select subscribers" on public.subscribers
  for select to anon using (true);

-- bookings: no direct anon write — only via the book_event RPC (security definer).

grant select, insert, update on public.subscribers to anon;
grant select on public.events to anon;

-- ── Brevo sync trigger ─────────────────────────────────────────────────────
-- Every subscribers/bookings INSERT pings the sync-brevo-contact edge function.
create or replace function public.notify_brevo_sync()
returns trigger
language plpgsql
security definer
as $$
declare
  function_url text := 'https://{{supabase.projectRef}}.supabase.co/functions/v1/sync-brevo-contact';
begin
  perform net.http_post(
    url := function_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'type', TG_OP, 'table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA,
      'record', row_to_json(NEW), 'old_record', null
    )
  );
  return NEW;
end;
$$;

drop trigger if exists trg_brevo_sync_subscribers on public.subscribers;
create trigger trg_brevo_sync_subscribers
  after insert on public.subscribers
  for each row execute function public.notify_brevo_sync();

drop trigger if exists trg_brevo_sync_bookings on public.bookings;
create trigger trg_brevo_sync_bookings
  after insert on public.bookings
  for each row execute function public.notify_brevo_sync();

-- ── book_event RPC ─────────────────────────────────────────────────────────
create or replace function public.book_event(
  p_event_slug text, p_name text, p_email text,
  p_newsletter boolean default false, p_promo_code text default null
)
returns table (
  booking_id uuid, event_id uuid, title text, event_slug text,
  event_date date, start_at timestamptz, end_at timestamptz,
  betrag integer, remaining_places integer, cancel_token text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_booking public.bookings%rowtype;
  v_email text; v_name text; v_promo text; v_betrag integer;
begin
  v_email := lower(trim(p_email));
  v_name  := nullif(trim(coalesce(p_name, '')), '');
  v_promo := upper(nullif(trim(coalesce(p_promo_code, '')), ''));

  if p_event_slug is null or trim(p_event_slug) = '' then
    raise exception 'EVENT_REQUIRED' using errcode = 'P0001';
  end if;
  if v_email is null or v_email = '' then
    raise exception 'EMAIL_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_event from public.events where slug = trim(p_event_slug) for update;
  if not found or not v_event.is_active then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.event_id = v_event.id and b.email = v_email and b.status = 'confirmed'
  ) then
    raise exception 'ALREADY_BOOKED' using errcode = 'P0001';
  end if;

  if v_event.booked_count >= v_event.capacity then
    raise exception 'SOLD_OUT' using errcode = 'P0001';
  end if;

  if v_promo is not null and v_promo <> upper('{{booking.promoCode}}') then
    raise exception 'INVALID_PROMO_CODE' using errcode = 'P0001';
  end if;

  v_betrag := case when v_promo = upper('{{booking.promoCode}}') then 0 else {{booking.price}} end;

  insert into public.bookings (event_id, event_date, name, email, promo_code, betrag, newsletter)
  values (v_event.id, v_event.event_date, v_name, v_email, v_promo, v_betrag, coalesce(p_newsletter, false))
  returning * into v_booking;

  update public.events set booked_count = booked_count + 1 where id = v_event.id;

  return query select
    v_booking.id, v_event.id, v_event.title, v_event.slug, v_event.event_date,
    v_event.start_at, v_event.end_at, v_booking.betrag,
    (v_event.capacity - (v_event.booked_count + 1)), v_booking.cancel_token;
end;
$$;

-- ── cancel_booking RPC ─────────────────────────────────────────────────────
create or replace function public.cancel_booking(p_cancel_token text)
returns table (booking_id uuid, name text, event_date date, event_id uuid)
language plpgsql security definer set search_path = public
as $$
declare v_booking public.bookings%rowtype;
begin
  if p_cancel_token is null or trim(p_cancel_token) = '' then
    raise exception 'TOKEN_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings where cancel_token = trim(p_cancel_token) for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'BOOKING_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;

  update public.bookings set status = 'cancelled', cancelled_at = now() where id = v_booking.id;
  update public.events set booked_count = greatest(booked_count - 1, 0) where id = v_booking.event_id;

  return query select v_booking.id, v_booking.name, v_booking.event_date, v_booking.event_id;
end;
$$;

-- ── event_availability RPC (anon-callable, drives the live counters) ───────--
create or replace function public.event_availability()
returns table (slug text, title text, event_date date, capacity integer, remaining_places integer)
language sql stable security definer set search_path = public
as $$
  select slug, title, event_date, capacity, greatest(capacity - booked_count, 0)
  from public.events
  where is_active = true
  order by event_date;
$$;

revoke all on function public.book_event(text, text, text, boolean, text) from public;
grant execute on function public.book_event(text, text, text, boolean, text) to service_role;
revoke all on function public.cancel_booking(text) from public;
grant execute on function public.cancel_booking(text) to service_role;
grant execute on function public.event_availability() to anon, authenticated;

-- ── seed events (from site.config.json) ────────────────────────────────────
insert into public.events (slug, title, event_date, start_at, end_at, capacity, is_active)
values
{{derived.eventsSeedSql}}
on conflict (slug) do update set
  title = excluded.title, event_date = excluded.event_date,
  start_at = excluded.start_at, end_at = excluded.end_at,
  capacity = excluded.capacity, is_active = excluded.is_active;
