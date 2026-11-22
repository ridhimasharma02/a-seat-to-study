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

You need [Node.js](https://nodejs.org) 22.13 or newer. There's nothing to install: no dependencies.

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

## How it's built

| Part | What |
|---|---|
| `server/server.js` | Node HTTP server: JSON API, login sessions (HttpOnly cookies, scrypt-hashed passwords), live updates, static files |
| `server/bookings.js` | Booking rules: availability, reserve, check in, break, check out, automatic release |
| `server/db.js` | SQLite database (Node's built-in `node:sqlite`): tables and first-run demo data |
| `public/js/iso.js` | The 3D isometric view: desks, chairs and rooms as 3D boxes, projected and drawn as SVG |
| `server/sim.js` | Demo activity: simulated students reserve, check in, take breaks and leave |
| `server/config.js` | The rules (15-min check-in window, 20-min breaks, 1–3 h bookings) and the study spaces |
| `public/js/pages/staff.js`, `stafflogin.js` | The staff portal and its login page |
| `public/` | The website: plain HTML, CSS and JavaScript modules, no build step |
| `prototype-v1/` | The earlier single-page prototype, kept for reference |

The database file is created in `data/` on first run. It is not committed to Git.

## Please note

This is a course prototype. Seat layouts, seat counts and all activity are **demo data**. It is not connected to any LPU system, and no real seat is booked. A real deployment would need the library's approval, verified floor plans and sockets, and QR stickers on the desks.
