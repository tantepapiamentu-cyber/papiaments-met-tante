
export async function onRequestGet({ request, env }) {
  const reply = (body, status = 200) =>
    Response.json(body, {
      status,
      headers: {
        "Cache-Control": "no-store"
      }
    });

  try {
    // Controleer of de serverinstellingen aanwezig zijn.
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return reply(
        {
          error: "Serverconfiguratie ontbreekt",
          code: "CONFIG_MISSING"
        },
        503
      );
    }

    // Lees en controleer de datums.
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const validDate = (value) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
      !Number.isNaN(Date.parse(value + "T00:00:00Z"));

    if (!validDate(from) || !validDate(to) || from >= to) {
      return reply(
        {
          error: "Ongeldige datum",
          code: "DATE_INVALID"
        },
        400
      );
    }

    // Supabase-instellingen.
    const baseUrl = env.SUPABASE_URL.replace(/\/+$/, "");

    // Gebruik voor beide headers dezelfde service_role-sleutel.
    const headers = {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    };

    // Haal gegevens veilig op uit Supabase.
    async function getData(table, path) {
      let response;

      try {
        response = await fetch(
          `${baseUrl}/rest/v1/${path}`,
          { headers }
        );
      } catch (error) {
        console.error("Supabase network error:", table);

        throw {
          code: `NETWORK_${table}`,
          status: 502
        };
      }

      if (!response.ok) {
        const details = await response.text();

        console.error(
          "Supabase request failed:",
          table,
          response.status,
          details.slice(0, 600)
        );

        throw {
          code: `SUPABASE_${table}_${response.status}`,
          status: 502
        };
      }

      return response.json();
    }

    // Beschikbare lesmomenten ophalen.
    const slots = await getData(
      "SLOTS",
      `lesson_slots?select=id,date,start_time,duration_minutes,max_children&date=gte.${from}&date=lt.${to}&order=date.asc,start_time.asc`
    );

    // Bestaande bevestigde boekingen ophalen.
    const bookings = await getData(
      "BOOKINGS",
      `bookings?select=slot_id,child_count,location,status&status=eq.bevestigd&lesson_date=gte.${from}&lesson_date=lt.${to}`
    );

    // Bereken hoeveel kinderen per lesmoment zijn geboekt.
    const booked = new Map();

    for (const booking of bookings) {
      const current = booked.get(booking.slot_id) || {
        count: 0,
        home: false
      };

      current.count += Number(booking.child_count) || 0;

      if (booking.location === "thuis") {
        current.home = true;
      }

      booked.set(booking.slot_id, current);
    }

    // Gebruik de Nederlandse datum.
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Amsterdam",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

    // Filter de beschikbare lestijden.
    const available = slots
      .filter((slot) => slot.date >= today)

      .filter((slot) => {
        const current = booked.get(slot.id);

        return (
          !current ||
          (
            !current.home &&
            current.count < slot.max_children
          )
        );
      })

      .filter((slot) => {
        const start = Date.parse(
          `${slot.date}T${slot.start_time}`
        );

        const end =
          start + slot.duration_minutes * 60000;

        return !slots.some((other) => {
          if (other.id === slot.id) {
            return false;
          }

          const otherBooking = booked.get(other.id);

          if (!otherBooking || otherBooking.count === 0) {
            return false;
          }

          const otherStart = Date.parse(
            `${other.date}T${other.start_time}`
          );

          const otherEnd =
            otherStart + other.duration_minutes * 60000;

          return (
            start < otherEnd &&
            otherStart < end
          );
        });
      })

      .map((slot) => ({
        ...slot,
        remaining:
          slot.max_children -
          (booked.get(slot.id)?.count || 0)
      }));

    return reply(available);

  } catch (error) {
    console.error("Availability failure:", error);

    return reply(
      {
        error: "Agenda tijdelijk niet beschikbaar",
        code: error?.code || "UNEXPECTED"
      },
      error?.status || 500
    );
  }
}
