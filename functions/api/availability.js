
export async function onRequestGet({ request, env }) {
  try {
    const urlPresent = Boolean(env?.SUPABASE_URL);
    const keyPresent = Boolean(env?.SUPABASE_SERVICE_ROLE_KEY);

    if (!urlPresent || !keyPresent) {
      return Response.json(
        {
          error: "Server nog niet ingesteld",
          urlAanwezig: urlPresent,
          sleutelAanwezig: keyPresent
        },
        { status: 503 }
      );
    }

    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    if (
      !datePattern.test(from || "") ||
      !datePattern.test(to || "") ||
      from >= to
    ) {
      return Response.json(
        { error: "Ongeldige datum" },
        { status: 400 }
      );
    }

    const baseUrl = env.SUPABASE_URL.replace(/\/+$/, "");

    const headers = {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    };

    async function getData(path) {
      const response = await fetch(
        `${baseUrl}/rest/v1/${path}`,
        { headers }
      );

      if (!response.ok) {
        throw new Error("Database niet bereikbaar");
      }

      return response.json();
    }

    const slots = await getData(
      `lesson_slots?select=id,date,start_time,duration_minutes,max_children&date=gte.${from}&date=lt.${to}&order=date.asc,start_time.asc`
    );

    const bookings = await getData(
      `bookings?select=slot_id,child_count,location,status&status=eq.bevestigd&lesson_date=gte.${from}&lesson_date=lt.${to}`
    );

    const booked = new Map();

    for (const booking of bookings) {
      const current = booked.get(booking.slot_id) || {
        count: 0,
        home: false
      };

      current.count += booking.child_count;
      current.home ||= booking.location === "thuis";

      booked.set(booking.slot_id, current);
    }

    const today = new Date().toISOString().slice(0, 10);

    const available = slots
      .filter(slot => slot.date >= today)
      .filter(slot => {
        const current = booked.get(slot.id);

        return (
          !current ||
          (!current.home && current.count < slot.max_children)
        );
      })
      .filter(slot => {
        const start = Date.parse(
          `${slot.date}T${slot.start_time}`
        );

        const end = start + slot.duration_minutes * 60000;

        return !slots.some(other => {
          if (other.id === slot.id) return false;

          const otherBooking = booked.get(other.id);

          if (!otherBooking || otherBooking.count === 0) {
            return false;
          }

          const otherStart = Date.parse(
            `${other.date}T${other.start_time}`
          );

          const otherEnd =
            otherStart + other.duration_minutes * 60000;

          return start < otherEnd && otherStart < end;
        });
      })
      .map(slot => ({
        ...slot,
        remaining:
          slot.max_children -
          (booked.get(slot.id)?.count || 0)
      }));

    return Response.json(available, {
      headers: {
        "Cache-Control": "no-store"
      }
    });

  } catch (error) {
    console.error("Availability error:", error.message);

    return Response.json(
      { error: "Agenda tijdelijk niet beschikbaar" },
      { status: 500 }
    );
  }
}
