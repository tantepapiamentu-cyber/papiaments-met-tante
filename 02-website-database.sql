-- STAP 5: voer dit script uit in een NIEUWE Supabase SQL query.
-- Het maakt tabellen voor de website (lesson_slots, bookings) aan.
-- De eerder gemaakte lestijden/boekingen blijven bestaan maar worden niet gebruikt.
-- Nog niet geschikt voor publieke lancering: e-mail en spambeveiliging ontbreken.

-- Plak dit in Supabase > SQL Editor > New query en klik Run.
-- Maak daarna in Authentication > Users één gebruiker voor Tante.
-- Vervang onderaan het e-mailadres door haar echte loginmail en voer die INSERT apart uit.
create table if not exists public.lesson_slots (id bigint generated always as identity primary key,date date not null,start_time time not null,unique(date,start_time));
create table if not exists public.bookings (id uuid primary key default gen_random_uuid(),slot_id bigint not null unique references public.lesson_slots(id),child_name text not null,age integer not null,child_count integer not null,kind text not null,lesson_date date not null,start_time time not null,location text not null,address text,parent_name text not null,parent_email text not null,parent_phone text not null,note text,status text not null default 'bevestigd',total_eur numeric(8,2) not null,created_at timestamptz not null default now());
create table if not exists public.admin_users (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.lesson_slots enable row level security;
alter table public.bookings enable row level security;
alter table public.admin_users enable row level security;
revoke all on public.bookings from anon,authenticated;
revoke all on public.admin_users from anon,authenticated;
grant select,insert,delete on public.lesson_slots to authenticated;
grant usage,select on sequence public.lesson_slots_id_seq to authenticated;
-- Veilig controleren of de ingelogde gebruiker Tante is.
create or replace function public.is_tante_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where user_id = (select auth.uid()));
$$;
revoke all on function public.is_tante_admin() from public;
grant execute on function public.is_tante_admin() to authenticated;
create policy "admin slots read" on public.lesson_slots for select to authenticated using (public.is_tante_admin());
create policy "admin slots insert" on public.lesson_slots for insert to authenticated with check (public.is_tante_admin());
create policy "admin slots delete" on public.lesson_slots for delete to authenticated using (public.is_tante_admin());
grant select on public.bookings to authenticated;
create policy "admin bookings read" on public.bookings for select to authenticated using (public.is_tante_admin());
create or replace view public.available_slots with (security_invoker=false) as select s.date,s.start_time from public.lesson_slots s where s.date>=current_date and not exists(select 1 from public.bookings b where b.slot_id=s.id);
revoke all on public.available_slots from public;grant select on public.available_slots to anon,authenticated;
create or replace function public.book_lesson(p_date date,p_time time,p_child text,p_age integer,p_count integer,p_kind text,p_location text,p_address text,p_parent text,p_email text,p_phone text,p_note text) returns uuid language plpgsql security definer set search_path=public as $$
declare v_slot bigint;v_id uuid;v_duration integer;v_total numeric;begin
if p_date<current_date or p_age<4 or p_age>120 or p_count<1 or p_count>12 or p_kind not in ('prive','groep') or p_location not in ('tante','thuis') or length(trim(p_child))<1 or length(p_child)>160 or length(trim(p_parent))<1 or length(p_parent)>100 or length(p_email)>200 or p_email not like '%@%.%' or length(trim(p_phone))<6 or length(p_phone)>30 or length(coalesce(p_note,''))>400 or (p_location='thuis' and length(trim(coalesce(p_address,'')))<5) then raise exception 'Controleer de ingevulde gegevens';end if;
select id into v_slot from public.lesson_slots where date=p_date and start_time=p_time for update;
if v_slot is null or exists(select 1 from public.bookings where slot_id=v_slot) then raise exception 'Dit tijdstip is niet meer beschikbaar';end if;
v_duration:=case when p_age=4 then 30 else 60 end;v_total:=(case when v_duration=30 then 7.50 else 10.00 end)*p_count+(case when p_location='thuis' then 2.50 else 0 end);
insert into public.bookings(slot_id,child_name,age,child_count,kind,lesson_date,start_time,location,address,parent_name,parent_email,parent_phone,note,total_eur) values(v_slot,trim(p_child),p_age,p_count,p_kind,p_date,p_time,p_location,case when p_location='thuis' then trim(p_address) else null end,trim(p_parent),trim(p_email),trim(p_phone),left(coalesce(p_note,''),400),v_total) returning id into v_id;return v_id;end;$$;
revoke all on function public.book_lesson(date,time,text,integer,integer,text,text,text,text,text,text,text) from public;
grant execute on function public.book_lesson(date,time,text,integer,integer,text,text,text,text,text,text,text) to anon,authenticated;
-- LET OP: boekings-RPC is nog NIET beschermd tegen spam. NIET publiek lanceren.
-- Als Tante is aangemaakt in Authentication > Users, voer daarna uit met haar echte e-mailadres:
-- insert into public.admin_users(user_id) select id from auth.users where email='TANTE_EMAIL_HIER';
