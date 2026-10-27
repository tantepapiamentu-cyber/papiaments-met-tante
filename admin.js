
const cfg = window.APP_CONFIG || {};

const statusElement = document.querySelector("#status");
const loginForm = document.querySelector("#login");
const panel = document.querySelector("#panel");

let token = "";

function msg(message) {
  statusElement.textContent = message;
}

function getConfig() {
  const url = String(cfg.supabaseUrl || "").trim();
  const key = String(cfg.supabaseAnonKey || "").trim();

  if (!url || !key) {
    throw new Error("Supabase-configuratie ontbreekt.");
  }

  if (!url.startsWith("https://")) {
    throw new Error("De Supabase-URL is ongeldig.");
  }

  return {
    url: url.replace(/\/+$/, ""),
    key
  };
}

async function readResponse(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "De server geeft geen geldig JSON-antwoord. Controleer de API-URL."
    );
  }
}

function getErrorMessage(data, fallback) {
  if (!data || typeof data !== "object") {
    return fallback;
  }

  return (
    data.msg ||
    data.error_description ||
    data.message ||
    data.error ||
    fallback
  );
}

async function auth(path, body) {
  const { url, key } = getConfig();

  const response = await fetch(
    `${url}/auth/v1/${path}`,
    {
      method: "POST",
      headers: {
        apikey: key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await readResponse(response);

  if (!response.ok) {
    if (
      response.status === 401 ||
      response.status === 403
    ) {
      throw new Error(
        getErrorMessage(
          data,
          "Inloggen geweigerd. Controleer de API-sleutel en inloggegevens."
        )
      );
    }

    throw new Error(
      getErrorMessage(
        data,
        `Inloggen mislukt (HTTP ${response.status}).`
      )
    );
  }

  return data;
}

async function db(path, options = {}) {
  const { url, key } = getConfig();

  if (!token) {
    throw new Error("Je bent niet ingelogd.");
  }

  const response = await fetch(
    `${url}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const data = await readResponse(response);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        data,
        `Databasefout (HTTP ${response.status}).`
      )
    );
  }

  return data;
}

loginForm.onsubmit = async (event) => {
  event.preventDefault();

  msg("Bezig met inloggen...");

  try {
    getConfig();

    const email = document.querySelector("#email").value.trim();
    const password = document.querySelector("#password").value;

    if (!email || !password) {
      throw new Error("Vul je e-mailadres en wachtwoord in.");
    }

    const session = await auth(
      "token?grant_type=password",
      {
        email,
        password
      }
    );

    if (!session || !session.access_token) {
      throw new Error(
        "Supabase heeft geen geldige inlogsessie teruggegeven."
      );
    }

    token = session.access_token;

    const isAdmin = await db(
      "rpc/is_tante_admin",
      {
        method: "POST",
        body: "{}"
      }
    );

    if (isAdmin !== true) {
      token = "";

      throw new Error(
        "Dit account heeft geen beheerdersrechten."
      );
    }

    loginForm.hidden = true;
    panel.hidden = false;

    msg("Succesvol ingelogd.");

    await load();

  } catch (error) {
    token = "";
    msg(error.message || "Inloggen mislukt.");
  }
};

document.querySelector("#logout").onclick = () => {
  token = "";
  window.location.reload();
};

document.querySelector("#add").onsubmit = async (event) => {
  event.preventDefault();

  try {
    const date = document.querySelector("#date").value;
    const startTime = document.querySelector("#time").value;
    const duration = Number(
      document.querySelector("#durationMinutes").value
    );

    if (!date || !startTime) {
      throw new Error("Vul een datum en tijd in.");
    }

    if (![30, 60].includes(duration)) {
      throw new Error("Kies 30 of 60 minuten.");
    }

    await db(
      "lesson_slots",
      {
        method: "POST",
        headers: {
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          date,
          start_time: startTime,
          duration_minutes: duration
        })
      }
    );

    msg("Lesmoment toegevoegd.");

    await load();

  } catch (error) {
    msg("Toevoegen mislukt: " + error.message);
  }
};

async function load() {
  try {
    const [slots, reservations] = await Promise.all([
      db(
        "lesson_slots?select=id,date,start_time,duration_minutes&order=date.asc,start_time.asc&limit=150"
      ),
      db(
        "bookings?select=id,slot_id,lesson_date,start_time,location,parent_name,parent_email,parent_phone,status,total_eur,booking_children(child_name,age)&order=lesson_date.asc,start_time.asc&limit=150"
      )
    ]);

    const slotsElement = document.querySelector("#openSlots");
    slotsElement.replaceChildren();

    for (const slot of slots) {
      const paragraph = document.createElement("p");

      paragraph.textContent =
        `${slot.date} ${slot.start_time.slice(0, 5)} ` +
        `(${slot.duration_minutes} min) `;

      const button = document.createElement("button");
      button.textContent = "Verwijderen";

      button.onclick = async () => {
        const confirmed = confirm(
          "Weet je zeker dat je dit lesmoment wilt verwijderen? " +
          "Bestaande boekingen moeten eerst worden afgehandeld."
        );

        if (!confirmed) {
          return;
        }

        try {
          await db(
            `lesson_slots?id=eq.${slot.id}`,
            {
              method: "DELETE"
            }
          );

          msg("Lesmoment verwijderd.");
          await load();

        } catch (error) {
          msg(
            "Verwijderen mislukt: " + error.message
          );
        }
      };

      paragraph.appendChild(button);
      slotsElement.appendChild(paragraph);
    }

    const bookingsElement = document.querySelector("#bookings");
    bookingsElement.replaceChildren();

    for (const reservation of reservations) {
      const paragraph = document.createElement("p");

      const children = (
        reservation.booking_children || []
      )
        .map(
          (child) =>
            `${child.child_name} (${child.age} jaar)`
        )
        .join(", ");

      paragraph.textContent = [
        reservation.lesson_date,
        reservation.start_time.slice(0, 5),
        children,
        reservation.parent_name,
        reservation.parent_email,
        reservation.location,
        `€${reservation.total_eur}`,
        reservation.status
      ].filter(Boolean).join(" · ");

      bookingsElement.appendChild(paragraph);
    }

    if (!reservations.length) {
      bookingsElement.textContent =
        "Nog geen afspraken.";
    }

  } catch (error) {
    msg("Laden mislukt: " + error.message);
  }
}
