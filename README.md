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
3. **Google Authenticator code:** the first time, Everest asks for a code for the new browser. The board then says so — type the current code from the app into that hotel's **Code** box and click import again. After that, Everest remembers the browser and no code is needed (saved in `.browser-profile/`).

Under **More settings**:
- **Months per hotel** + **"Next month" button** selector — read several months in a row.
- **Show the browser while importing** — watch what happens if something goes wrong. Screenshots of failures are saved in `debug/`.

Logins are only sent to the local server on this computer. Passwords are not saved unless you tick *Remember passwords on this computer*.

## Clear all data

**Clear all data** (top right of the import panel, click twice) deletes all imported bookings and the cleaning plans so you can import fresh data. Staff names and the bin-day setting are kept.

## Manual import

The old bookmark + paste import is still available under **Manual import**.
