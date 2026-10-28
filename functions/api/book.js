
export async function onRequestPost({ request, env }) {
  const json = (data, status = 200) =>
    Response.json(data, {
      status,
      headers: { "Cache-Control": "no-store" }
    });

  try {
    if (
      !env.SUPABASE_URL ||
      !env.SUPABASE_SERVICE_ROLE_KEY ||
      !env.GOOGLE_SCRIPT_URL ||
      !env.MAIL_WEBHOOK_SECRET
    ) {
      return json({ error: "Boeken is nog niet geactiveerd" }, 503);
    }

    if (Number(request.headers.get("content-length") || 0) > 12000) {
      return json({ error: "Te veel gegevens" }, 413);
    }

    const p = await request.json();

    if (p.website) {
      return json({ error: "Ongeldige aanvraag" }, 400);
    }

    if (
      !Number.isSafeInteger(p.slot_id) ||
      !Array.isArray(p.children) ||
      p.children.length < 1 ||
      p.children.length > 6
    ) {
      return json({ error: "Controleer de kinderen" }, 400);
    }

    const base = env.SUPABASE_URL.replace(/\/+$/, "");

    const headers = {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY
    };

    const rpc = await fetch(
      base + "/rest/v1/rpc/reserve_lesson_internal",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_slot_id: p.slot_id,
          p_children: p.children,
          p_location: p.location,
          p_address: "",
          p_parent_name: p.parent_name,
          p_parent_email: p.parent_email,
          p_parent_phone: "",
          p_note: p.note || ""
        })
      }
    );

    const bookingId = await rpc.json().catch(() => null);

    if (!rpc.ok) {
      return json(
        {
          error:
            "Dit tijdstip is mogelijk niet meer beschikbaar. Controleer de gegevens en probeer opnieuw."
        },
        400
      );
    }

    // De reservering is nu definitief.
    // Een mailfout mag geen tweede boeking veroorzaken.
    try {
      const detailsResponse = await fetch(
        base +
          "/rest/v1/bookings?select=id,lesson_date,start_time,location,parent_name,parent_email,note,total_eur&id=eq." +
          encodeURIComponent(String(bookingId)) +
          "&limit=1",
        { headers }
      );

      if (!detailsResponse.ok) {
        throw new Error("BOOKING_LOOKUP_" + detailsResponse.status);
      }

      const rows = await detailsResponse.json();
      const booking = rows[0];

      if (!booking) {
        throw new Error("BOOKING_NOT_FOUND");
      }

      const payload = {
        secret: env.MAIL_WEBHOOK_SECRET,
        booking_id: String(booking.id),
        date: booking.lesson_date,
        time: String(booking.start_time).slice(0, 5),
        location: booking.location,
        parent_name: booking.parent_name,
        parent_email: booking.parent_email,
        children: p.children.map((c) => ({
          name: String(c.name),
          age: Number(c.age)
        })),
        note: booking.note || "",
        total_eur: Number(booking.total_eur)
      };

      const sent = await fetch(env.GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify(payload),
        redirect: "follow"
      });

      if (!sent.ok) {
        throw new Error("MAIL_HTTP_" + sent.status);
      }

      const result = await sent.json();

      if (!result.ok) {
        throw new Error(
          "MAIL_RESPONSE_" + String(result.error || "unknown")
        );
      }

      return json({ ok: true });
    } catch (mailError) {
      console.error(
        "Booking saved, email delivery failed:",
        mailError.message
      );

      return json({
        ok: true,
        email_warning: true
      });
    }
  } catch (error) {
    console.error("Booking endpoint error", error);

    return json(
      { error: "Boeken tijdelijk niet mogelijk" },
      500
    );
  }
}
