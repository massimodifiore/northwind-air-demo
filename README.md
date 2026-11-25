# Northwind Air: Demo Website

A static demo site for an airline. It shows booking, fare search, rebooking, flight status, contact center callbacks, an email form, and a chat assistant, plus a demo admin page to prepare and reset the data. It has no backend: bookings and flight status overrides are kept in the browser's local storage, and nothing is sent anywhere except the chat.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and all sections |
| `admin.html` | Demo admin page, linked from the site footer |
| `styles.css` | Visual design |
| `data.js` | Shared by both pages: airports, fares, flight generator, and the local storage store |
| `app.js` | Site logic: search, booking, rebooking, fares, status, forms, chat |
| `admin.js` | Admin logic: create, change and delete bookings, flight status overrides, reset |
| `README.md` | This file |

## Run it locally

Open `index.html` in any browser. No install or build step is needed.

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
- **Rebook:** enter code `DEMO01` and last name `Rivera` to load a sample booking, or any code created with the Book tab or the admin page.
- **Flight status:** enter a flight number such as `NW 123` and a date. Results are generated sample data unless the admin page overrides that flight.
- **Contact us:** shows a click-to-call number, a callback request form, and a message form.
- **Chat:** the bottom-right button opens Genesys Cloud Web Messenger (deployment `LaunchPad-Airline`). The last tool used on the site is sent to the chat as `site_last_task`.

## Demo admin page

Open **Demo admin** in the site footer (`admin.html`). Before a demonstration:

- **Create a booking:** click **New booking**, enter the passenger, route, dates and cabin, and pick the flights. Leave the code empty to generate one, or type a six-character code you want to quote.
- **Change a booking:** click **Edit** on a booking and change any detail, such as the date or flight. The code stays the same, so the customer finds the changed trip on the Rebook tab.
- **Set a flight status:** enter a flight number (booked flights are suggested), choose a status such as Delayed or Cancelled, and optionally a delay and gate. The Flight status tab shows it on every date until you remove it.
- **Reset after the demo:** click **Reset demo data**. Every booking and override is removed and `DEMO01` is restored, dated 10 days from today.

Data lives in this browser's local storage: another browser, device or private window has its own copy, and the chat assistant and agents can't see it. An open site tab picks up admin changes made in another tab.

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

- A backend API for schedules, fares, inventory, and bookings.
- A payment provider, such as Stripe, and a PCI-compliant checkout.
- An email service for confirmations and the contact form.
- A real chat or contact center platform.
- Authentication for managing bookings.

The fictional airline, airports, phone number, fares, and flight data are all sample values. The phone number uses the reserved 555 range.
