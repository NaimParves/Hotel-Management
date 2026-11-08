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

Logins are only sent to your own board server. Passwords are not saved unless you tick *Remember passwords on this device*.

## Use it on your phone (Render.com, free)

The board page is on GitHub Pages: <https://naimparves.github.io/Hotel-Management/>.
For the import it needs the board server running online. Set it up once:

1. Go to <https://render.com> and sign up for free with your GitHub account.
2. Click **New** → **Blueprint**, choose the **Hotel-Management** repository and click **Deploy**.
   Render reads `render.yaml` and builds the server (takes about 5–10 minutes the first time).
3. When it says **Live**, copy the address at the top (normally `https://everest-board.onrender.com`).
   If it is different, open the board on the phone → **More settings** → **Board server address** and paste it there.
4. On the phone open the board, enter the logins and click **Log in & import both hotels**.
   - The first time, Everest asks for a **Google Authenticator code**: a Code box appears under that hotel. Type the current code and import again. The phone remembers it, so it is not needed again.
   - The free server sleeps after ~15 minutes without use. The first import after a break takes about a minute longer while it wakes up.

Each device keeps its own board data (bookings and plans are saved in that browser).

## Cleaning plan

Assign people in the **Week overview**: click a person's day to switch Itzling (I) → Grödig (G) → both hotels (IG) → Frei (F) → empty. If someone starts later, pick the time under that day (e.g. "from 12:00"); it shows in the Week plan and the downloaded image. Click a name to rename it.

## Clear all data

**Clear all data** (top right of the import panel, click twice) deletes all imported bookings and the cleaning plans (in this browser) so you can import fresh data. The board stays empty until the next import. Staff names and the bin-day setting are kept.

