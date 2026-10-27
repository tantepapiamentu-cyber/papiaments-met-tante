
export async function onRequestGet({ request, env }) {
  const reply = (body, status = 200) =>
    Response.json(body, {
      status,
      headers: {
        "Cache-Control": "no-store"
      }
    });

  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return reply(
        {
          error: "Serverconfiguratie ontbreekt",
          code: "CONFIG_MISSING"
        },
        503
      );
    }

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

    const baseUrl = env.SUPABASE_URL.replace(/\/+$/, "");

    const headers = {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    };

    async function getData(name, path) {
      let response;

      try {
        response = await fetch(
          `${baseUrl}/rest/v1/${path}`,
          { headers }
        );
      } catch (error) {
        throw {
          code: `NETWORK_${name}`,
          status: 502
        };
      }

      if (!response.ok) {
        const details = await response.text();

        console.error(
          "Supabase request failed:",
          name,
          response.status,
          details.slice(0, 400)
        );

        throw {
          code: `SUPABASE_${name}_${response.status}`,
          status: 502
        };
      }

      return response.json();
    }

    // Zorg dat de vaste wekelijkse lestijden
    // automatisch worden aangevuld.
    const generation = await fetch(
      `${baseUrl}/rest/v1/rpc/refresh_weekly_lesson_slots`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: "{}"
      }
    );

    if (!generation.ok) {
      console.error(
        "Weekly generation failed:",
        generation.status,
        (await generation.text()).slice(0, 400)
      );

      throw {
        code: `WEEKLY_GENERATION_${generation.status}`,
        status: 502
      };
    }

    // Haal lestijden, boekingen en blokkades op.
    const [slots, bookings, blocks] = await Promise.all([
      getData(
        "SLOTS",
        `lesson_slots?select=id,date,start_time,duration_minutes,max_children&date=gte.${from}&date=lt.${to}&order=date.asc,start_time.asc`
      ),
      getData(
        "BOOKINGS",
        `bookings?select=slot_id,child_count,location,status&status=eq.bevestigd&lesson_date=gte.${from}&lesson_date=lt.${to}`
      ),
      getData(
        "BLOCKS",
        `lesson_blocks?select=day,part&day=gte.${from}&day=lt.${to}`
      )
    ]);

    // Tel bestaande boekingen per lestijd.
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

    // Verzamel geblokkeerde dagdelen.
    const blockMap = new Map();

    for (const block of blocks) {
      if (!blockMap.has(block.day)) {
        blockMap.set(block.day, new Set());
      }

      blockMap.get(block.day).add(block.part);
    }

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Amsterdam",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

    function intersectsBlockedPart(slot, part) {
      const start =
        Number(slot.start_time.slice(0, 2)) * 60 +
        Number(slot.start_time.slice(3, 5));

      const end = start + Number(slot.duration_minutes);

      if (part === "morning") {
        return start < 720;
      }

      return end > 720;
    }

    // Bereken welke lestijden ouders mogen boeken.
    const available = slots
      .filter((slot) => slot.date >= today)

      .filter((slot) => {
        return !["morning", "afternoon"].some((part) => {
          return (
            blockMap.get(slot.date)?.has(part) &&
            intersectsBlockedPart(slot, part)
          );
        });
      })

      .filter((slot) => {
        const current = booked.get(slot.id);

        return (
          !current ||
          (
            !current.home &&
            current.count < Number(slot.max_children)
          )
        );
      })

      .filter((slot) => {
        const start = Date.parse(
          `${slot.date}T${slot.start_time}`
        );

        const end =
          start + Number(slot.duration_minutes) * 60000;

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
            otherStart +
            Number(other.duration_minutes) * 60000;

          return (
            start < otherEnd &&
            otherStart < end
          );
        });
      })

      .map((slot) => ({
        ...slot,
        remaining:
          Number(slot.max_children) -
          (booked.get(slot.id)?.count || 0)
      }));

    // De ouderpagina verwacht precies deze indeling.
    return reply({
      slots: available,
      blocked: blocks
    });

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
