# Northwind Air: Demo Website

A static demo site for an airline. It shows booking, fare search, rebooking, flight status, contact center callbacks, an email form, and a chat assistant, plus a demo admin page to prepare and reset the data. Bookings and flight status overrides are kept by a small Cloudflare Worker (`api/`), so the website, the admin page and the chat assistant all see the same sample data.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and all sections |
| `admin.html` | Demo admin page, linked from the site footer |
| `styles.css` | Visual design |
| `data.js` | Shared by both pages and the Worker: airports, fares, flight generator, and the API client |
| `app.js` | Site logic: search, booking, rebooking, fares, status, forms, chat |
| `admin.js` | Admin logic: create, change and delete bookings, flight status overrides, reset |
| `api/worker.js` | Cloudflare Worker: the bookings and status store (Workers KV) and the chat assistant's endpoints |
| `api/wrangler.toml` | Worker configuration: name and KV binding |
| `README.md` | This file |

## Run it locally

Serve the folder with any static server, for example `python3 -m http.server 8765`, and open `http://localhost:8765/`. The pages use the deployed Worker.

To work on the Worker too, run `npx wrangler dev` in `api/` (it serves `http://localhost:8787` with a local KV store), and open the site with `?api=http://localhost:8787`. Only `localhost` addresses are accepted in `?api=`. The chat assistant's endpoints need an `AVA_API_KEY`; for local runs, put `AVA_API_KEY=<any test value>` in `api/.dev.vars`, which is not committed.

## The API (Cloudflare Worker)

The Worker is deployed at `https://northwind-air-api.massimodifiore.workers.dev`. If you deploy your own, change `DEFAULT_API` in `data.js` and the allowed origins (`ORIGINS`) in `api/worker.js`.

Endpoints for the website and admin page (no key; demo data only):

| Method and path | Purpose |
| --- | --- |
| `GET /api/state` | All bookings and flight status overrides |
| `PUT /api/bookings/{code}` | Save a booking; add `?create=1` to refuse a code already in use (409) |
| `DELETE /api/bookings/{code}` | Delete a booking |
| `PUT /api/status/{flight}`, `DELETE /api/status/{flight}` | Set or remove a flight status override |
| `POST /api/reset` | Remove everything and restore `DEMO01` |

Endpoints for the chat assistant's Genesys Cloud data actions (header `x-api-key` required):

| Method and path | Purpose |
| --- | --- |
| `GET /ava/destinations` | Airports served |
| `POST /ava/booking-request` | Check and normalize a trip request (airports by code or city, dates, cabin, passengers) |
| `GET /ava/flights?from_airport&to_airport&date&cabin&passengers` | Flights and fares for one date |
| `POST /ava/bookings` | Create a booking; returns `booking_code` and `total_fare` |

Errors are returned as HTTP status codes: 400 invalid input, 401 missing or wrong key, 404 unknown airport or flight, 409 code in use, 503 anything else.

To deploy: `npx wrangler kv namespace create BOOKINGS`, put the id in `api/wrangler.toml`, run `npx wrangler deploy` in `api/`, then set the key with `npx wrangler secret put AVA_API_KEY` and give the same value to the Genesys Cloud integration.

## Publish on GitHub Pages

1. Create a new repository on GitHub, for example `northwind-air-demo`. Set it to **Public**, since free GitHub Pages sites require it.
2. Upload the files to the repository root. You can drag them onto the repository page in the browser, or push them with git:
   ```bash
   git init
   git add .
   git commit -m "Add Northwind Air demo site"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/northwind-air-demo.git
   git push -u origin main
   ```
3. In the repository, go to **Settings > Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose **main** and **/ (root)**, then click **Save**.
5. After about a minute, the site is live at `https://YOUR-USERNAME.github.io/northwind-air-demo/`.

## Demo walkthrough

- **Book:** choose a route, dates, passengers, and cabin, then pick flights and enter passenger details to get a confirmation code.
- **Fares:** see the lowest fares for the seven days around a chosen date. Click **Book this date** to jump to booking.
- **Rebook:** enter code `DEMO01` and last name `Rivera` to load a sample booking, or any code created with the Book tab, the admin page or the chat assistant.
- **Flight status:** enter a flight number such as `NW 123` and a date. Results are generated sample data unless the admin page overrides that flight.
- **Contact us:** shows a click-to-call number, a callback request form, and a message form.
- **Chat:** the bottom-right button opens Genesys Cloud Web Messenger (deployment `LaunchPad-Airline`). The last tool used on the site is sent to the chat as `site_last_task`.

## Demo admin page

Open **Demo admin** in the site footer (`admin.html`). Before a demonstration:

- **Create a booking:** click **New booking**, enter the passenger, route, dates and cabin, and pick the flights. Leave the code empty to generate one, or type a six-character code you want to quote.
- **Change a booking:** click **Edit** on a booking and change any detail, such as the date or flight. The code stays the same, so the customer finds the changed trip on the Rebook tab.
- **Set a flight status:** enter a flight number (booked flights are suggested), choose a status such as Delayed or Cancelled, and optionally a delay and gate. The Flight status tab shows it on every date until you remove it.
- **Reset after the demo:** click **Reset demo data**. Every booking and override is removed and `DEMO01` is restored, dated 10 days from today.

The data is shared: everyone using this demo sees the same bookings, so use fictional names and emails only. Workers KV is eventually consistent, so a booking made in the chat can take up to a minute to appear; click **Refresh** on the admin page, or search again on the Rebook tab.

## Customizing

Most of the content is easy to change:

- **Airline name and colors:** search for `Northwind` in `index.html`, and edit the colors at the top of `styles.css`.
- **Airports:** edit the `AIRPORTS` list near the top of `data.js`.
- **Phone number:** search for `555-0142` in `index.html` and `app.js`.
- **Fares and change fees:** edit `CABIN_MULT` and `CHANGE_FEE` in `data.js`.
- **Sample booking:** edit `seed()` in `data.js`.
- **Chat:** edit `GENESYS` in `app.js` to point at another Messenger deployment.

## Notes for a real deployment

This demo uses placeholder data and does not connect to any airline systems. To make it live, you would need:

- A real backend for schedules, fares, inventory, and bookings in place of the demo Worker.
- A payment provider, such as Stripe, and a PCI-compliant checkout.
- An email service for confirmations and the contact form.
- A real chat or contact center platform.
- Authentication for managing bookings.

The fictional airline, airports, phone number, fares, and flight data are all sample values. The phone number uses the reserved 555 range.
