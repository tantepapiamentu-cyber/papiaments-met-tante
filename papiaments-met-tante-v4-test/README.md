# Papiaments met Tante — versie 4 (TESTVERSIE)

## Inhoud
- `site/`: website met centrale kalender, meerdere kinderen per ouder en beheerpagina.
- `functions/api/`: Cloudflare Pages Functions voor beschikbare tijden en beveiligde boeking.

## Publiceren (nog niet voor echte ouders)
1. Upload **de inhoud** van deze ZIP naar een privé GitHub-repository.
2. Maak Cloudflare Pages aan via GitHub, build command leeg, **build output directory `site`**. LET OP: Cloudflare Pages Functions moeten in de root van de repository in `functions/` staan.
3. Vul in `site/config.js` alleen Supabase Project URL en publieke anon/publishable key in voor Tante haar login.
4. Cloudflare Pages > Settings > Variables and Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret), `RESEND_API_KEY` (secret), `MAIL_FROM` (geverifieerde afzender), `TANTE_EMAIL`. Geheimen nooit in GitHub of `config.js`.
5. Maak in Resend een geverifieerd afzenderdomein aan; zonder dat mag de website geen echte boekingen aannemen.

## Nog te testen / verbeteren vóór livegang
- Test alle boekingsscenario's, waaronder gelijktijdige reserveringen en overlap.
- Controleer dat `reserve_lesson_internal` alleen door service_role aanroepbaar is.
- E-mails bevatten nu slot-ID; voeg datum/tijd toe na betrouwbare lookup.
- Voeg botbescherming (Cloudflare Turnstile), rate limiting, privacyverklaring, bewaartermijnen en verwijderprocedure toe.
- Controleer dat Tante als enige beheerder kan inloggen en gegevens kan lezen.
- Controleer RLS en rechten van `booking_children`; mogelijk is nog een aparte policy nodig voor het inzien via `bookings`.
- De publieke agenda geeft een indicatie; server valideert definitief bij boeken.
- Cloudflare Pages Functions deploy en Resend API nog niet getest.

**Deze versie is een werkende codebasis, maar nog geen geteste productieversie.**
