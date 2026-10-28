
const form = document.querySelector("#form");
const cal = document.querySelector("#calendar");
const slots = document.querySelector("#slots");
const status = document.querySelector("#status");

let month = new Date();
month.setDate(1);

let day = "";
let slot = null;
let available = [];
let blocked = [];
let loadError = "";

const euro = (n) =>
  new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR"
  }).format(n);

const pad = (n) => String(n).padStart(2, "0");

const iso = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;


// ----------------------------------
// MELDINGEN
// ----------------------------------

function notice(text, bad = false) {
  status.textContent = text;
  status.className = bad ? "error" : "success";
}


// ----------------------------------
// API
// ----------------------------------

async function request(url, opts) {
  const response = await fetch(url, opts);

  const data = await response.json().catch(() => ({
    error: "Onbekende fout"
  }));

  if (!response.ok) {
    throw Error(data.error || "Er ging iets mis");
  }

  return data;
}


// ----------------------------------
// BESCHIKBAARHEID OPHALEN
// ----------------------------------

async function refresh() {
  loadError = "";

  try {
    const end = new Date(month);
    end.setMonth(end.getMonth() + 1);

    const data = await request(
      `/api/availability?from=${iso(month)}&to=${iso(end)}`
    );

    available = data.slots;
    blocked = data.blocked;

    if (
      !Array.isArray(available) ||
      !Array.isArray(blocked)
    ) {
      throw Error("Onverwacht antwoord");
    }

  } catch (error) {
    available = [];
    blocked = [];

    loadError =
      "De beschikbare lestijden kunnen nog niet geladen worden. " +
      error.message;
  }

  render();
}


// ----------------------------------
// KALENDER
// ----------------------------------

function render() {
  document.querySelector("#month").textContent =
    month.toLocaleDateString("nl-NL", {
      month: "long",
      year: "numeric"
    });

  const error = document.querySelector("#calendar-error");

  error.hidden = !loadError;
  error.textContent = loadError;

  cal.replaceChildren();

  for (const text of [
    "Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"
  ]) {
    const element = document.createElement("div");

    element.className = "dow";
    element.textContent = text;

    cal.append(element);
  }

  const firstDay = (month.getDay() + 6) % 7;

  for (let i = 0; i < firstDay; i++) {
    cal.append(document.createElement("div"));
  }

  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0
  ).getDate();

  for (let i = 1; i <= daysInMonth; i++) {
    const date = iso(
      new Date(
        month.getFullYear(),
        month.getMonth(),
        i
      )
    );

    const button = document.createElement("button");

    button.type = "button";
    button.textContent = i;

    button.disabled = date < iso(new Date());

    const hasAvailability = available.some(
      (item) => item.date === date
    );

    const dayBlocks = blocked.filter(
      (item) => item.day === date
    );

    const full = dayBlocks.length === 2;
    const partial = dayBlocks.length === 1;

    button.className = [
      hasAvailability ? "available" : "unavailable",
      full ? "blocked-full" : partial ? "blocked-partial" : "",
      date === day ? "active" : ""
    ].join(" ");

    button.title = full
      ? "Niet beschikbaar"
      : partial
        ? dayBlocks[0].part === "morning"
          ? "Ochtend niet beschikbaar"
          : "Middag niet beschikbaar"
        : hasAvailability
          ? "Beschikbaar"
          : "Niet beschikbaar";

    button.setAttribute(
      "aria-label",
      new Date(
        month.getFullYear(),
        month.getMonth(),
        i
      ).toLocaleDateString("nl-NL", {
        day: "numeric",
        month: "long",
        year: "numeric"
      })
    );

    button.setAttribute(
      "aria-pressed",
      String(date === day)
    );

    button.onclick = () => {
      day = date;
      slot = null;
      render();
    };

    cal.append(button);
  }

  renderSlots();
}


// ----------------------------------
// BESCHIKBARE LESTIJDEN
// ----------------------------------

function renderSlots() {
  slots.replaceChildren();

  const label = document.querySelector("#slot-label");

  label.textContent = day
    ? "Beschikbare tijden op " +
      day.split("-").reverse().join("-")
    : "Kies hierboven eerst een datum.";

  if (!day) return;

  if (loadError) {
    label.textContent =
      "De tijden zijn nog niet beschikbaar.";
    return;
  }

  const found = available.filter(
    (item) => item.date === day
  );

  if (!found.length) {
    label.textContent =
      "Niet beschikbaar. Kies een groene datum.";
    return;
  }

  const dayBlocks = blocked.filter(
    (item) => item.day === day
  );

  if (dayBlocks.length) {
    const info = document.createElement("p");

    info.className = "block-notice";

    info.textContent =
      dayBlocks.length === 2
        ? "Niet beschikbaar"
        : dayBlocks[0].part === "morning"
          ? "Ochtend niet beschikbaar"
          : "Middag niet beschikbaar";

    slots.append(info);
  }

  for (const item of found) {
    const button = document.createElement("button");

    button.type = "button";

    const time = document.createElement("span");

    time.textContent =
      item.start_time.slice(0, 5) +
      " – " +
      endTime(item);

    const remaining = document.createElement("small");

    remaining.textContent =
      item.remaining +
      " " +
      (item.remaining === 1 ? "plek" : "plekken") +
      " vrij";

    button.append(time, remaining);

    button.className =
      slot?.id === item.id ? "active" : "";

    button.setAttribute(
      "aria-pressed",
      String(slot?.id === item.id)
    );

    button.onclick = () => {
      slot = item;
      renderSlots();
    };

    slots.append(button);
  }
}

function endTime(item) {
  const [hours, minutes] =
    item.start_time.split(":").map(Number);

  const total =
    hours * 60 +
    minutes +
    (Number(item.duration_minutes) || 60);

  return (
    pad(Math.floor(total / 60) % 24) +
    ":" +
    pad(total % 60)
  );
}


// ----------------------------------
// MAAND NAVIGATIE
// ----------------------------------

document.querySelector("#prev").onclick = () => {
  const previous = new Date(
    month.getFullYear(),
    month.getMonth() - 1,
    1
  );

  const currentMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  );

  if (previous < currentMonth) return;

  month = previous;
  day = "";
  slot = null;

  refresh();
};

document.querySelector("#next").onclick = () => {
  month = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    1
  );

  day = "";
  slot = null;

  refresh();
};


// ----------------------------------
// KINDEREN EN LEEFTIJDEN
// ----------------------------------

const children = document.querySelector("#children");

function ages(select) {
  for (let age = 4; age <= 18; age++) {
    const option = document.createElement("option");

    option.value = age;
    option.textContent = age + " jaar";

    select.append(option);
  }

  const more = document.createElement("option");

  more.value = "19";
  more.textContent = "19 jaar of ouder";

  select.append(more);
}

ages(children.querySelector(".child-age"));

function getChildren() {
  return [
    ...children.querySelectorAll(".child-entry")
  ].map((entry) => ({
    name: entry
      .querySelector(".child-name")
      .value.trim(),

    age: Number(
      entry.querySelector(".child-age").value
    )
  }));
}


// ----------------------------------
// PRIJS EN LESDUUR
// ----------------------------------

function update() {
  const kids = getChildren();

  const valid = kids.filter(
    (kid) => kid.age >= 4
  );

  const amount =
    valid.reduce(
      (sum, child) =>
        sum + (child.age === 4 ? 7.5 : 10),
      0
    ) +
    (form.elements.location.value === "thuis"
      ? 2.5
      : 0);

  document.querySelector("#price").textContent =
    euro(amount);

  document.querySelector("#duration").textContent =
    !valid.length
      ? "Kies een leeftijd"
      : valid.every((child) => child.age === 4)
        ? "30 minuten"
        : "60 minuten";

  document.querySelector("#addChild").disabled =
    kids.length >= 6;

  [
    ...children.querySelectorAll(".child-title")
  ].forEach((element, index) => {
    element.textContent = "Kind " + (index + 1);
  });
}


// ----------------------------------
// KIND TOEVOEGEN
// ----------------------------------

document.querySelector("#addChild").onclick = () => {
  if (getChildren().length >= 6) return;

  const wrapper = document.createElement("div");

  wrapper.className = "child-entry";

  wrapper.innerHTML = `
    <div class="child-title"></div>

    <label>
      Naam van je kind
      <input
        class="child-name"
        required
        maxlength="160"
        placeholder="Voornaam"
      >
    </label>

    <label>
      Leeftijd
      <select class="child-age" required>
        <option value="">Kies leeftijd</option>
      </select>
    </label>

    <button
      type="button"
      class="remove-child"
    >
      Verwijder dit kind
    </button>
  `;

  ages(wrapper.querySelector(".child-age"));

  wrapper.querySelector("button").onclick = () => {
    wrapper.remove();
    update();
  };

  children.append(wrapper);
  update();
};

children.addEventListener("input", update);
children.addEventListener("change", update);

form.elements.location.addEventListener(
  "change",
  update
);

update();


// ----------------------------------
// BOEKING VERSTUREN
// ----------------------------------

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!slot) {
    notice(
      "Kies eerst een beschikbare datum en tijd.",
      true
    );
    return;
  }

  const kids = getChildren();

  if (
    kids.some(
      (kid) => !kid.name || kid.age < 4
    )
  ) {
    notice(
      "Vul de naam en leeftijd van ieder kind in.",
      true
    );
    return;
  }

  if (kids.length > slot.remaining) {
    notice(
      "Er zijn niet genoeg plaatsen voor alle kinderen.",
      true
    );
    return;
  }

  const fields = form.elements;
  const button = document.querySelector("#submit");

  button.disabled = true;

  notice("We verwerken je afspraak…");

  try {
    const confirmation = await request(
      "/api/book",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          slot_id: slot.id,
          children: kids,
          location: fields.location.value,
          address: "",
          parent_name: fields.parent.value,
          parent_email: fields.email.value,
          parent_phone: "",
          note: fields.note.value,
          website: ""
        })
      }
    );

    if (confirmation.email_warning) {
      notice(
        "Je afspraak is opgeslagen, maar de e-mail kon niet worden verstuurd. Neem contact op met Tante.",
        true
      );
    } else {
      notice("");
      showBookingSuccess();
    }

    form.reset();

    children
      .querySelectorAll(
        ".child-entry:not(:first-child)"
      )
      .forEach((element) => element.remove());

    day = "";
    slot = null;

    update();
    await refresh();

  } catch (error) {
    notice(
      "Boeken niet gelukt: " + error.message,
      true
    );

    await refresh();

  } finally {
    button.disabled = false;
  }
});


// ----------------------------------
// SUCCES POP-UP
// ----------------------------------

function showBookingSuccess() {
  let dialog = document.querySelector(
    "#booking-success-dialog"
  );

  if (!dialog) {
    dialog = document.createElement("dialog");

    dialog.id = "booking-success-dialog";

    dialog.setAttribute(
      "aria-labelledby",
      "booking-success-title"
    );

    dialog.innerHTML = `
      <div class="booking-success-content">

        <div
          class="booking-success-icon"
          aria-hidden="true"
        >
          ✓
        </div>

        <h2 id="booking-success-title">
          Je afspraak is geboekt! 🎉
        </h2>

        <p>
          Je ontvangt een bevestiging per e-mail.
        </p>

        <p class="booking-success-spam">
          ✉️ Geen e-mail ontvangen?
          Kijk ook even in je spammap.
        </p>

        <button
          type="button"
          class="booking-success-close"
        >
          Sluiten
        </button>

      </div>
    `;

    const style = document.createElement("style");

    style.textContent = `
      #booking-success-dialog {
        border: 0;
        border-radius: 22px;
        padding: 0;
        width: min(420px, calc(100% - 32px));
        max-width: 420px;
        background: #fffaf2;
        color: #50362b;
        box-shadow: 0 16px 55px #24140d55;
      }

      #booking-success-dialog::backdrop {
        background: #20181099;
      }

      .booking-success-content {
        padding: 32px 24px;
        text-align: center;
        font-family: inherit;
      }

      .booking-success-icon {
        display: grid;
        place-items: center;
        margin: 0 auto 16px;
        width: 64px;
        height: 64px;
        border-radius: 50%;
        background: #e5f3e8;
        color: #21875b;
        font-size: 36px;
        font-weight: bold;
      }

      .booking-success-content h2 {
        margin: 0 0 12px;
        color: #50362b;
        font-size: 24px;
      }

      .booking-success-content p {
        line-height: 1.55;
        margin: 12px 0;
        color: #59473c;
      }

      .booking-success-spam {
        padding: 14px;
        border-radius: 12px;
        background: #f6eadc;
        font-size: 14px;
      }

      .booking-success-close {
        margin-top: 12px;
        width: 100%;
        padding: 14px 20px;
        border: 0;
        border-radius: 28px;
        background: #e8a47e;
        color: #50362b;
        font-weight: 700;
        font-size: 16px;
        cursor: pointer;
      }

      .booking-success-close:focus-visible {
        outline: 3px solid #21875b;
        outline-offset: 3px;
      }
    `;

    document.head.append(style);
    document.body.append(dialog);

    dialog
      .querySelector(".booking-success-close")
      .addEventListener("click", () => {
        dialog.close();
      });

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });
  }

  dialog.showModal();

  dialog
    .querySelector(".booking-success-close")
    .focus();
}


// ----------------------------------
// UITLEG KLEUREN KALENDER
// ----------------------------------

const legend = document.createElement("div");

legend.className = "parent-availability-legend";

legend.innerHTML = `
  <span>
    <i class="legend-green"></i>
    Beschikbaar
  </span>

  <span>
    <i class="legend-red"></i>
    Niet beschikbaar
  </span>
`;

cal.insertAdjacentElement("afterend", legend);


// ----------------------------------
// START
// ----------------------------------

refresh();
