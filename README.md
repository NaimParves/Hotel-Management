# Itzling & Grödig Check-in Board

Check-ins, check-outs and the cleaning plan for both hotels, with automatic import from Everest (booking.onestephost.com).

## Start

1. Install [Node.js](https://nodejs.org) (once).
2. Double-click **start.bat**. The first start installs everything (takes a few minutes), then the board opens at <http://localhost:3000>.
   Or from a terminal: `npm run setup` once, then `npm start`.
3. Keep the black server window open while you use the board.

## Automatic import

Each hotel has its own Everest account, so there are two login boxes: **Itzling login** and **Grödig login**.

1. Enter username and password for one hotel or both.
2. Click **Log in & import both hotels**.
   For each hotel a hidden browser logs in to Everest, lands on that account's planning page, reads the grid and fills the board.
3. **Google Authenticator code:** if Everest asks for a code (usually only the first time), an Everest window opens by itself. Type the code from the app there and click Login; the import then continues. After that Everest remembers the browser (saved in `.browser-profile/`).

Under **More settings**:
- **Months to import** — 1 month (this month) or 2 months (this month + next month). For 2 months the importer clicks the next-month arrow on the planning page by itself.
- If an import fails, a screenshot of the Everest page is saved in `debug/`.

Logins are only sent to the local server on this computer. Passwords are not saved unless you tick *Remember passwords on this computer*.

## Cleaning plan

Assign people in the **Week overview**: click a person's day to switch Itzling (I) → Grödig (G) → both hotels (IG) → Frei (F) → empty. If someone starts later, pick the time under that day (e.g. "from 12:00"); it shows in the Week plan and the downloaded image. Click a name to rename it.

## Clear all data

**Clear all data** (top right of the import panel, click twice) deletes all imported bookings and the cleaning plans (in this browser) so you can import fresh data. The board stays empty until the next import. Staff names and the bin-day setting are kept.

