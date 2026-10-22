-- Papiaments met Tante - versie 6: telefoon en adres niet verplicht
-- Eenmalig uitvoeren nadat stap 21 al is uitgevoerd.
-- Vooraf: de bestaande tabellen lesson_slots, bookings, booking_children en admin_users zijn aanwezig.
-- De functie is bedoeld voor boekingen zonder accounts; de website moet nog server-side anti-spam en e-mail toevoegen.
BEGIN;

-- Eén gezin kan meerdere kinderen in één boeking opnemen.
ALTER TABLE public.bookings ALTER COLUMN child_name DROP NOT NULL;
ALTER TABLE public.bookings ALTER COLUMN age DROP NOT NULL;
ALTER TABLE public.bookings ALTER COLUMN kind DROP NOT NULL;
ALTER TABLE public.bookings ALTER COLUMN kind SET DEFAULT 'groep';
ALTER TABLE public.bookings ALTER COLUMN parent_phone DROP NOT NULL;
ALTER TABLE public.lesson_slots ADD COLUMN IF NOT EXISTS max_children integer NOT NULL DEFAULT 6;
ALTER TABLE public.lesson_slots ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 60;

-- Houd deze functie buiten de publieke API; later aanroepen via een beveiligde server.
CREATE OR REPLACE FUNCTION public.reserve_lesson_internal(
  p_slot_id bigint,
  p_children jsonb,
  p_location text,
  p_address text,
  p_parent_name text,
  p_parent_email text,
  p_parent_phone text,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_slot public.lesson_slots%ROWTYPE;
  v_count integer;
  v_existing integer;
  v_id uuid;
  v_total numeric(8,2);
  v_child jsonb;
  v_age integer;
  v_name text;
  v_start timestamp;
  v_end timestamp;
BEGIN
  -- Serialize all reservations for Tante, including overlapping slots.
  PERFORM pg_advisory_xact_lock(81624021);
  IF p_children IS NULL OR jsonb_typeof(p_children) <> 'array' THEN
    RAISE EXCEPTION 'Vul de kinderen in';
  END IF;
  v_count := jsonb_array_length(p_children);
  IF v_count NOT BETWEEN 1 AND 6
    OR p_location NOT IN ('tante','thuis')
    OR length(btrim(coalesce(p_parent_name,''))) NOT BETWEEN 1 AND 100
    OR length(btrim(coalesce(p_parent_email,''))) NOT BETWEEN 5 AND 200
    OR p_parent_email NOT LIKE '%@%.%'
    OR length(coalesce(p_note,'')) > 400
      THEN RAISE EXCEPTION 'Controleer de ingevulde gegevens'; END IF;

  SELECT * INTO v_slot FROM public.lesson_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tijdstip niet beschikbaar'; END IF;
  IF v_slot.max_children NOT BETWEEN 1 AND 6 OR v_slot.duration_minutes NOT IN (30,60) THEN
    RAISE EXCEPTION 'Ongeldig lestijdslot';
  END IF;
  v_start := v_slot.date + v_slot.start_time;
  v_end := v_start + make_interval(mins => v_slot.duration_minutes);
  IF v_start <= (now() AT TIME ZONE 'Europe/Amsterdam') THEN
    RAISE EXCEPTION 'Tijdstip ligt in het verleden';
  END IF;

  -- Any overlapping reserved slot blocks this slot, except the same slot for shared lessons at Tante.
  IF EXISTS (
    SELECT 1 FROM public.bookings b
    JOIN public.lesson_slots s ON s.id = b.slot_id
    WHERE b.status = 'bevestigd'
      AND s.id <> v_slot.id
      AND (s.date + s.start_time) < v_end
      AND (s.date + s.start_time + make_interval(mins => s.duration_minutes)) > v_start
  ) THEN RAISE EXCEPTION 'Dit tijdstip overlapt met een andere les'; END IF;

  SELECT coalesce(sum(b.child_count),0)::integer INTO v_existing
  FROM public.bookings b
  WHERE b.slot_id = v_slot.id AND b.status = 'bevestigd';
  IF (p_location = 'thuis' AND v_existing > 0)
     OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.slot_id = v_slot.id AND b.status = 'bevestigd' AND b.location = 'thuis')
     OR v_existing + v_count > v_slot.max_children
  THEN RAISE EXCEPTION 'Niet genoeg plaatsen beschikbaar'; END IF;

  v_total := CASE WHEN p_location = 'thuis' THEN 2.50 ELSE 0 END;
  FOR v_child IN SELECT value FROM jsonb_array_elements(p_children) LOOP
    IF jsonb_typeof(v_child) <> 'object' OR (v_child->>'age') !~ '^[0-9]{1,3}$' THEN
      RAISE EXCEPTION 'Ongeldige kindgegevens';
    END IF;
    v_age := (v_child->>'age')::integer;
    v_name := btrim(coalesce(v_child->>'name',''));
    IF v_age NOT BETWEEN 4 AND 120 OR length(v_name) NOT BETWEEN 1 AND 160 THEN
      RAISE EXCEPTION 'Ongeldige kindgegevens';
    END IF;
    IF v_age >= 5 AND v_slot.duration_minutes < 60 THEN
      RAISE EXCEPTION 'Voor kinderen vanaf 5 jaar is 60 minuten nodig';
    END IF;
    v_total := v_total + CASE WHEN v_age = 4 THEN 7.50 ELSE 10.00 END;
  END LOOP;

  INSERT INTO public.bookings
    (slot_id, child_count, kind, lesson_date, start_time, location, address,
     parent_name, parent_email, parent_phone, note, total_eur)
  VALUES
    (v_slot.id, v_count, 'groep', v_slot.date, v_slot.start_time, p_location,
     NULL,
     btrim(p_parent_name), btrim(p_parent_email), NULL,
     coalesce(p_note,''), v_total)
  RETURNING id INTO v_id;

  FOR v_child IN SELECT value FROM jsonb_array_elements(p_children) LOOP
    INSERT INTO public.booking_children (booking_id, child_name, age)
    VALUES (v_id, btrim(v_child->>'name'), (v_child->>'age')::integer);
  END LOOP;
  RETURN v_id;
END;
$fn$;

-- No public or authenticated client may invoke this security-definer function directly.
REVOKE ALL ON FUNCTION public.reserve_lesson_internal(bigint,jsonb,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
-- Privileged server-side role only. Never expose its key to a browser.
GRANT EXECUTE ON FUNCTION public.reserve_lesson_internal(bigint,jsonb,text,text,text,text,text,text) TO service_role;
COMMIT;
