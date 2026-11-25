# A Seat to Study

A working prototype that helps LPU students find a free study seat before they leave the hostel, reserve it, and check in at the desk. Its four main screens follow the team's paper prototype: **Home → Find a Study Space → Library Seat Map → Book a Seat**.

INT335 · Design Thinking · Project P06 · Lovely Professional University

## What it does

**For students**
- **Find a Study Space:** filter by Library, Academic Block, Quiet Study, Group Study or *With Power Outlet*, search by location or block, and see how many seats are free now or at a later time.
- **Seat map:** each floor drawn with its tables, carrels or rooms. Seats are green (available), pink (occupied), dashed pink (on a break), yellow (reserved) or lavender (yours). A bolt marks a working socket.
- **3D view:** switch any seat map to an isometric 3D room. Rotate it, tilt it, zoom in, or drag to turn it, then click a chair or room to book it. Pointing at a chair shows its name and status.
- **Book a seat:** now or later today/tomorrow, for 1 to 3 hours.
- **Check in at the desk:** scan the QR sticker on the desk, or type its 4-letter code. If you don't check in within 15 minutes of your start time, the seat is released automatically.
- **Breaks:** a break keeps your seat for 20 minutes. Overrun it and the seat is released.
- **Report:** a seat held by a bag with nobody there, a dead socket, or noise.
- **Insights:** how full each space is right now, and its usual busy times by hour.

**For library staff** (a separate staff portal at `/staff`, with its own login page)
- **Reports:** every report from students, with what is happening at that seat right now (free, on a break, checked in), a *Show on map* button, and three outcomes: free the seat, mark the socket broken, or no problem found. Staff can add a note, and each report records who handled it and when. Students see the outcome on their Report page.
- **Seats in use:** every seat in use, filtered by space or status, including who is on a break or late to check in. Staff can free a seat.
- **Sockets:** sockets marked as not working, *Mark fixed*, and a form to mark a dead socket found on rounds.
- **Desk stickers:** printable QR stickers for any space.
- Demo activity on or off.

Every change shows up live for everyone (Server-Sent Events). Simulated "demo students" come and go so the library feels busy during a demo.

## Screenshots

From the running prototype with its demo data, in the order someone would use it. “Demo student” names are simulated users, and Aman Verma is an example account made for these screenshots. Click a picture to see it full size.

### Students

<table>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/01-login.png"><img src="docs/screenshots/01-login.png" alt="Open the app: the login page comes first"></a><br><b>1. Open the app: the login page comes first</b><br>Every visit starts here. Nothing else in the app opens until a student logs in with their LPU registration number.</td>
<td width="50%" valign="top"><a href="docs/screenshots/02-create-account.png"><img src="docs/screenshots/02-create-account.png" alt="Create an account"></a><br><b>2. Create an account</b><br>A new student signs up with their name, registration number and a password (at least 6 characters).</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/03-home.png"><img src="docs/screenshots/03-home.png" alt="Home: free seats at a glance"></a><br><b>3. Home: free seats at a glance</b><br>After signing up the student lands on Home, which shows how many seats are free in each study space right now.</td>
<td width="50%" valign="top"><a href="docs/screenshots/04-spaces.png"><img src="docs/screenshots/04-spaces.png" alt="Pick a study space"></a><br><b>4. Pick a study space</b><br>Spaces lists every library floor, the study hall and the group rooms, with live free counts and free seats with a working socket.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/05-floor-plan.png"><img src="docs/screenshots/05-floor-plan.png" alt="See the floor plan"></a><br><b>5. See the floor plan</b><br>Each seat is coloured by its state: free, reserved, occupied or on a break. Filters show only free seats or only seats with a working socket.</td>
<td width="50%" valign="top"><a href="docs/screenshots/06-seat-details.png"><img src="docs/screenshots/06-seat-details.png" alt="Choose a free seat (K5)"></a><br><b>6. Choose a free seat (K5)</b><br>Clicking a green seat opens its details: location, date and time, socket and zone, plus the Reserve button.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/07-3d-view.png"><img src="docs/screenshots/07-3d-view.png" alt="Or look at the room in 3D"></a><br><b>7. Or look at the room in 3D</b><br>The same room as a 3D view. It can be turned, tilted and zoomed, and seats can be picked here too. The chosen seat has a ring around it.</td>
<td width="50%" valign="top"><a href="docs/screenshots/08-reserved.png"><img src="docs/screenshots/08-reserved.png" alt="Reserve the seat"></a><br><b>8. Reserve the seat</b><br>One click reserves it. The app says when the check-in window opens and closes (up to 15 minutes after the start), or the seat goes back to everyone.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/09-my-bookings.png"><img src="docs/screenshots/09-my-bookings.png" alt="My Bookings"></a><br><b>9. My Bookings</b><br>The booking shows a countdown to the check-in deadline, with buttons to check in at the desk or cancel.</td>
<td width="50%" valign="top"><a href="docs/screenshots/10-checkin-code.png"><img src="docs/screenshots/10-checkin-code.png" alt="Check in at the desk"></a><br><b>10. Check in at the desk</b><br>At the seat, the student scans the QR sticker on the desk, or types the 4-character code printed on it.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/11-checked-in.png"><img src="docs/screenshots/11-checked-in.png" alt="Checked in"></a><br><b>11. Checked in</b><br>Scanning the desk QR code opens this page and checks the student in. The seat is now theirs until the booking ends.</td>
<td width="50%" valign="top"><a href="docs/screenshots/12-studying.png"><img src="docs/screenshots/12-studying.png" alt="Studying: take a break or check out"></a><br><b>12. Studying: take a break or check out</b><br>While checked in, the student can start a 20-minute break or check out early to free the seat for someone else.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/13-on-break.png"><img src="docs/screenshots/13-on-break.png" alt="On a break"></a><br><b>13. On a break</b><br>During a break the seat stays held and shows a countdown. Pressing “I’m back at my seat” resumes it.</td>
<td width="50%" valign="top"><a href="docs/screenshots/14-report.png"><img src="docs/screenshots/14-report.png" alt="Report a seat"></a><br><b>14. Report a seat</b><br>If a seat is held by a bag, or a socket does not work, the student reports it to the library staff.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/15-report-sent.png"><img src="docs/screenshots/15-report-sent.png" alt="Report sent"></a><br><b>15. Report sent</b><br>The report appears under “Your reports” and shows its status, and later who handled it.</td>
<td width="50%" valign="top"><a href="docs/screenshots/16-insights.png"><img src="docs/screenshots/16-insights.png" alt="Insights: when is it quiet?"></a><br><b>16. Insights: when is it quiet?</b><br>Insights shows how busy each space usually is hour by hour, so students can plan when to go.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/17-login-wall.png"><img src="docs/screenshots/17-login-wall.png" alt="Logged out: the login wall"></a><br><b>17. Logged out: the login wall</b><br>After logging out, opening any page (here My Bookings) sends you back to the login page.</td>
<td width="50%"></td>
</tr>
</table>

### Library staff

<table>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/18-staff-login-separate.png"><img src="docs/screenshots/18-staff-login-separate.png" alt="A separate login for library staff"></a><br><b>18. A separate login for library staff</b><br>Staff have their own login page. A student registration number is refused here, and staff IDs are refused on the student login.</td>
<td width="50%" valign="top"><a href="docs/screenshots/19-staff-reports.png"><img src="docs/screenshots/19-staff-reports.png" alt="Staff portal: seat reports"></a><br><b>19. Staff portal: seat reports</b><br>Library staff see every open report, with what is happening at that seat right now.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/20-staff-show-on-map.png"><img src="docs/screenshots/20-staff-show-on-map.png" alt="Show the reported seat on the map"></a><br><b>20. Show the reported seat on the map</b><br>“Show on map” opens the floor plan with the reported seat outlined, so staff can walk straight to it.</td>
<td width="50%" valign="top"><a href="docs/screenshots/21-staff-resolved.png"><img src="docs/screenshots/21-staff-resolved.png" alt="Handle the report"></a><br><b>21. Handle the report</b><br>Staff free the seat (or mark the socket broken, or note that nothing was wrong). The outcome, note and staff name are recorded.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/22-staff-seats.png"><img src="docs/screenshots/22-staff-seats.png" alt="Seats in use"></a><br><b>22. Seats in use</b><br>Every booked, occupied and on-break seat, filterable by space and status. Staff can free a seat from here.</td>
<td width="50%" valign="top"><a href="docs/screenshots/23-staff-sockets.png"><img src="docs/screenshots/23-staff-sockets.png" alt="Power sockets"></a><br><b>23. Power sockets</b><br>Broken sockets are listed for the maintenance team, who mark them fixed. Seats with a broken socket are left out when students filter for a working socket.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/24-staff-stickers.png"><img src="docs/screenshots/24-staff-stickers.png" alt="Desk QR stickers"></a><br><b>24. Desk QR stickers</b><br>Staff print a QR sticker for every desk. Scanning one checks the student in to that seat.</td>
<td width="50%"></td>
</tr>
</table>

## Logging in

There are two separate logins:

| | Page | Logs in with | Lands on |
|---|---|---|---|
| Students | `/login` (the first page you see) | Registration number + password | Home |
| Library staff | `/staff/login` | Staff ID + password | Staff portal |

- Nothing opens until you log in. A link opened while logged out (for example a desk's QR code) takes you back to that page after you log in.
- **Students and staff are kept apart.** The student login refuses staff accounts, and the staff login refuses students. A staff account can't open student pages, and a student can't open the staff portal. The server checks every request, not just the pages.
- Students can create their own account. Staff accounts are made by the library (here: the demo accounts below).
- **Passwords:** each login has a *Show* button and a Caps Lock warning, and a stray space before or after the password is ignored. Anyone can change their password from their name in the top bar (*Change password*); this logs out their other devices. Eight wrong passwords in a row lock that login page for a minute. Correct logins never count towards this, so switching between student and staff accounts is fine.
- The two login pages are kept separate for browser password managers too, so a saved student login isn't filled into the staff form.

## Run it

You need [Node.js](https://nodejs.org) 22.13 or newer.

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000. The terminal also prints a Wi-Fi address. Open it on a phone on the same network to scan desk QR stickers.

To wipe the database and start fresh:

```bash
npm run reset
```

### Demo logins

| Who | Login page | ID | Password |
|---|---|---|---|
| Student | `/login` | `12345678` | `study1234` |
| Librarian | `/staff/login` | `LIB001` | `staff1234` |
| Reading hall attendant | `/staff/login` | `LIB002` | `staff1234` |
| Maintenance | `/staff/login` | `MNT001` | `staff1234` |

Or create your own student account on the login page.

**Forgot a password, or want your own?** Set a new one for any account from the terminal. You type it privately, and nothing shows on screen:

```bash
npm run set-password -- LIB001
```

Use any Staff ID or student registration number in place of `LIB001`. It works while the app is running.

## Database: Supabase or local

The app keeps its data in **Supabase** (Postgres) when it's connected, and in a local SQLite file (`data/`) when it isn't. The code is the same for both.

**Connect to Supabase:**

1. Create a project at [supabase.com](https://supabase.com) (the free plan is enough) and note the database password.
2. In the project, click **Connect** and copy the **Session pooler** connection string.
3. Start the app (`npm start`), open **http://localhost:3000/setup**, paste your database password, and click **Test and save**. The connection string can stay as Supabase gives it, with the `[YOUR-PASSWORD]` placeholder. That page only works on the computer running the app, and it switches off once Supabase is set up.
   Or do the same in the terminal: `npm run connect-supabase`. To re-test a saved connection, run `npm run check-supabase`.

4. Restart the app (`npm start`). On the first start on Supabase it creates the tables in Supabase and loads the demo data: seats, demo students, and two weeks of history for Insights.

**What's on Supabase:**
- **Tables:** `users`, `sessions`, `spaces`, `seats`, `bookings`, `reports` and `settings`, visible in Supabase's Table Editor.
- **Row-level security** is on for every table. Supabase's public web API can't read or change them; only this server can, through its database connection.
- **Login:** the app still uses its own login (scrypt-hashed passwords, HttpOnly session cookies), not Supabase Auth.
- **Your password stays private.** The connection string includes your database password and lives only in `.env`, which Git ignores. `.env.example` shows the format.
- **To go back to the local database,** delete `.env`.

## Deploying on Vercel

The repo is ready for Vercel. `vercel.json` sends `/api/...` to the server function in `api/index.js` and serves the website from `public/`. The function runs in Tokyo (`hnd1`), next to the Supabase project. Change `regions` if your Supabase project is somewhere else.

1. In Vercel, import the GitHub repository (Framework: **Other**; root directory: the repository root; no build command).
2. **Settings → Environment Variables:** add `DATABASE_URL` with your Supabase connection string, with your real database password in place of `[YOUR-PASSWORD]`. The Session pooler string is fine; the app switches to Supabase's transaction pooler (port 6543) by itself.
3. Redeploy. If `DATABASE_URL` is missing or wrong, the site says so instead of loading forever.

**On Vercel there is no always-running server, so:**
- **Timed rules:** the 15-minute check-in window and the 20-minute break limit are applied when the next request arrives, not on a timer.
- **Live updates:** open pages refresh every 10 seconds instead of updating instantly.
- **The `/setup` page is off.** Use the environment variable instead.
- **Desk QR stickers** point to your Vercel address automatically.

## How it's built

| Part | What |
|---|---|
| `server/server.js` | Node HTTP server: JSON API, login sessions (HttpOnly cookies, scrypt-hashed passwords), live updates, static files |
| `server/bookings.js` | Booking rules: availability, reserve, check in, break, check out, automatic release |
| `api/index.js`, `vercel.json` | Running on Vercel: the server as a function, routes and region |
| `server/store.js` | One database interface for Supabase (Postgres, via `pg`) and local SQLite (Node's built-in `node:sqlite`) |
| `server/db.js` | Tables, row-level security, and the first-run demo data |
| `server/connect.js`, `public/js/pages/setup.js` | Connecting to Supabase from the terminal or from `/setup`: tests the connection and saves it to `.env` |
| `public/js/iso.js` | The 3D isometric view: desks, chairs and rooms as 3D boxes, projected and drawn as SVG |
| `server/sim.js` | Demo activity: simulated students reserve, check in, take breaks and leave |
| `server/config.js` | The rules (15-min check-in window, 20-min breaks, 1–3 h bookings) and the study spaces |
| `public/js/pages/staff.js`, `stafflogin.js` | The staff portal and its login page |
| `public/` | The website: plain HTML, CSS and JavaScript modules, no build step |
| `prototype-v1/` | The earlier single-page prototype, kept for reference |
| `docs/screenshots/` | The screenshots shown in this README |

Without Supabase, the database file is created in `data/` on first run. Neither `data/` nor `.env` is committed to Git.

## Please note

This is a course prototype. Seat layouts, seat counts and all activity are **demo data**. It is not connected to any LPU system, and no real seat is booked. A real deployment would need the library's approval, verified floor plans and sockets, and QR stickers on the desks.
