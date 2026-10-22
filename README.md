# Papiaments met Tante — versie 5 (mobiel ontwerp, TESTVERSIE)

- De originele flyer is bijgesneden tot de illustratie van Tante met kinderen; de flyerteksten zijn niet hergebruikt.
- Mobile-first website: datum → lestijd → kinderen → gegevens.
- Ook dagen zonder lestijden zijn aanklikbaar, met duidelijke uitleg.
- De agenda haalt echte beschikbare tijden op via `/api/availability`. Zonder werkende serverconfiguratie toont hij een foutmelding; geen nepboekingen.
- **Cloudflare Pages:** repository-root bevat `functions/` en `site/`; build command leeg; output directory `site`.
- Configureer in Cloudflare Settings → Variables and Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret), `RESEND_API_KEY` (secret), `MAIL_FROM`, `TANTE_EMAIL`.
- `site/config.js` heeft alleen de publieke Supabase URL en anon/publishable key nodig voor Tante-login.
- Niet geschikt voor echte boekingen vóór tests van API, RLS, reserveringscapaciteit, overlap, e-mails, spambeveiliging en privacy.
- De leeftijdsselector bevat 4 t/m 18 en een 19+-optie. Voor exacte leeftijden boven 19 kan die selector later worden uitgebreid.
