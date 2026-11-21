# Mis Facturas

A small PWA for a family business to track supplier invoices, payments and daily cash, synced to a Google Sheet.

- `app/` — the PWA (Vite + TypeScript). `npm install`, `npm run dev`, `npm test`, `npm run build`.
- `apps-script/` — the Google Apps Script backend bound to the Sheet. Tests: `node --test apps-script/test/code.test.js`.
- `docs/SETUP.md` — setup guide (Spanish / English). `docs/API.md` — the app ↔ script contract.
- `BRIEF.md` — product brief. `prototype.html` — original prototype. `mis-facturas.nib` + `icons/` — designs and app icons.

Try it with sample data: open the published site with `?demo`.
