# Northwind Air: Demo Website

A static demo site for an airline. It shows booking, fare search, rebooking, flight status, contact center callbacks, an email form, and a chat assistant. It has no backend, so nothing is stored or sent. Everything runs in the browser with sample data.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and all sections |
| `styles.css` | Visual design |
| `app.js` | Demo logic: search, booking, rebooking, fares, status, forms, chat |
| `README.md` | This file |

## Run it locally

Open `index.html` in any browser. No install or build step is needed.

## Publish on GitHub Pages

1. Create a new repository on GitHub, for example `northwind-air-demo`. Set it to **Public**, since free GitHub Pages sites require it.
2. Upload the four files to the repository root. You can drag them onto the repository page in the browser, or push them with git:
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
- **Rebook:** enter code `DEMO01` and last name `Rivera` to load a sample booking. You can also use any code you create with the Book tab during the same visit.
- **Flight status:** enter a flight number such as `NW 123` and a date. Results are sample data.
- **Contact us:** shows a click-to-call number, a callback request form, and a message form.
- **Chat:** the bottom-right button opens a rule-based assistant with quick replies.

## Customizing

Most of the content is easy to change:

- **Airline name and colors:** search for `Northwind` in `index.html`, and edit the colors at the top of `styles.css`.
- **Airports:** edit the `AIRPORTS` list near the top of `app.js`.
- **Phone number:** search for `555-0142` in `index.html` and `app.js`.
- **Fares and change fees:** edit `CABIN_MULT` and `CHANGE_FEE` in `app.js`.
- **Chat answers:** edit the `RULES` list in `app.js`.

## Notes for a real deployment

This demo uses placeholder data and does not connect to any airline systems. To make it live, you would need:

- A backend API for schedules, fares, inventory, and bookings.
- A payment provider, such as Stripe, and a PCI-compliant checkout.
- An email service for confirmations and the contact form.
- A real chat or contact center platform.
- Authentication for managing bookings.

The fictional airline, airports, phone number, fares, and flight data are all sample values. The phone number uses the reserved 555 range.
