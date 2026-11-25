// Northwind Air booking API: one store for the website, the admin page and the chat assistants.
// Public /api routes serve the website. /ava routes serve the Genesys Cloud data actions and need
// the x-api-key header that matches the AVA_API_KEY secret.
import '../data.js';

const D = globalThis.NorthwindData;
const ORIGINS = ['https://massimodifiore.github.io', 'http://localhost:8765', 'http://127.0.0.1:8765'];
const CABINS = { economy: 'Economy', premium: 'Premium', 'premium economy': 'Premium', business: 'Business' };
const TRIPS = { one_way: 'one_way', oneway: 'one_way', 'one way': 'one_way', round_trip: 'round_trip', round: 'round_trip', 'round trip': 'round_trip', return: 'round_trip' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------- Helpers ---------- */

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

function cors(req) {
  const origin = req.headers.get('origin');
  return ORIGINS.includes(origin)
    ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,PUT,POST,DELETE', 'access-control-allow-headers': 'content-type', vary: 'origin' }
    : {};
}

const json = (req, data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(req) }
});

async function body(req) {
  try { return await req.json(); } catch (e) { throw new HttpError(400, 'The request body is not valid JSON.'); }
}

function airport(value, field) {
  const v = fold(value);
  const hit = D.AIRPORTS.find(([code, city]) => fold(code) === v || fold(city) === v);
  if (!hit) throw new HttpError(404, `${field}: Northwind Air does not fly to "${value}".`);
  return hit[0];
}

/* Dates are YYYY-MM-DD. One day of slack covers callers ahead of UTC. */
function date(value, field, notBefore) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw new HttpError(400, `${field} must be a date like 2026-12-24.`);
  const min = notBefore || D.addDays(D.today(), -1);
  if (value < min) throw new HttpError(400, `${field} is in the past or before the outbound date.`);
  if (value > D.addDays(D.today(), 330)) throw new HttpError(400, `${field} is more than 330 days away.`);
  return value;
}

function cabin(value) {
  const c = fold(value) ? CABINS[fold(value)] : 'Economy';
  if (!c) throw new HttpError(400, 'cabin must be Economy, Premium or Business.');
  return c;
}

function passengers(value) {
  const n = value === undefined || value === null || value === '' ? 1 : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 6) throw new HttpError(400, 'passengers must be 1 to 6.');
  return n;
}

function name(value, field) {
  const s = String(value || '').trim();
  if (!s || s.length > 40) throw new HttpError(400, `${field} is required, up to 40 characters.`);
  return s;
}

function trip(value) {
  const t = TRIPS[fold(value)];
  if (!t) throw new HttpError(400, 'trip_type must be one_way or round_trip.');
  return t;
}

/* ---------- Store: the whole demo in one KV document ----------
   KV lists lag writes by up to a minute, so a reset built on a list could miss new bookings.
   Concurrent writers can overwrite each other; that is accepted for demo data. */

const STATE_KEY = 'state';

function seeded() {
  const now = new Date().toISOString();
  return { bookings: Object.fromEntries(D.seed().bookings.map((b) => [b.pnr, { ...b, source: 'seed', created: now }])), statusOverrides: {} };
}

async function load(env) {
  const s = await env.BOOKINGS.get(STATE_KEY, 'json');
  return s && s.bookings && s.statusOverrides ? s : seeded();
}

async function save(env, s) {
  await env.BOOKINGS.put(STATE_KEY, JSON.stringify(s));
  return s;
}

function view(s) {
  const bookings = Object.values(s.bookings).sort((a, b) => String(a.created || '').localeCompare(String(b.created || '')));
  return { bookings, statusOverrides: s.statusOverrides };
}

/* A booking from the website or admin page. Shapes are checked so the site can always render it. */
function checkBooking(b, pnr) {
  if (!b || b.pnr !== pnr || !/^[A-Z0-9]{6}$/.test(pnr)) throw new HttpError(400, 'The booking code must be 6 letters or digits and match the URL.');
  if (!Array.isArray(b.legs) || b.legs.length < 1 || b.legs.length > 2) throw new HttpError(400, 'A booking has one or two flights.');
  const legs = b.legs.map((l) => {
    const flight = D.flightsFor(airport(l.from, 'from'), airport(l.to, 'to'), date(l.date, 'date', '2000-01-01'))
      .find((f) => l.flight && f.number === l.flight.number);
    if (!flight) throw new HttpError(404, 'That flight does not run on that date.');
    return { from: l.from, to: l.to, date: l.date, flight, fare: flight.fares[cabin(b.cabin)] };
  });
  return {
    pnr,
    firstName: name(b.firstName, 'firstName'),
    lastName: name(b.lastName, 'lastName'),
    email: String(b.email || '').trim().slice(0, 80),
    cabin: cabin(b.cabin),
    pax: passengers(b.pax),
    legs,
    source: ['site', 'admin', 'chat', 'seed'].includes(b.source) ? b.source : 'site',
    created: b.created || new Date().toISOString()
  };
}

/* ---------- AVA routes ---------- */

function bookingRequest(q) {
  const t = fold(q.trip_type) ? trip(q.trip_type) : (q.return_date ? 'round_trip' : 'one_way');
  const from = airport(q.from_airport, 'from_airport');
  const to = airport(q.to_airport, 'to_airport');
  if (from === to) throw new HttpError(400, 'from_airport and to_airport must differ.');
  const depart = date(q.depart_date, 'depart_date');
  const ret = t === 'round_trip' ? date(q.return_date, 'return_date', depart) : '';
  return {
    trip_type: t,
    from_airport: from, from_city: D.cityOf(from),
    to_airport: to, to_city: D.cityOf(to),
    depart_date: depart, return_date: ret,
    passengers: passengers(q.passengers),
    cabin: cabin(q.cabin),
    first_name: name(q.first_name, 'first_name'),
    last_name: name(q.last_name, 'last_name')
  };
}

function flights(q) {
  const from = airport(q.from_airport, 'from_airport');
  const to = airport(q.to_airport, 'to_airport');
  if (from === to) throw new HttpError(400, 'from_airport and to_airport must differ.');
  const day = date(q.date, 'date');
  const c = cabin(q.cabin);
  const pax = passengers(q.passengers);
  return {
    flights: D.flightsFor(from, to, day).map((f) => ({
      flight_number: f.number,
      departs: D.fmtTime(f.dep),
      arrives: D.fmtTime(f.arr) + (D.dayOffset(f.arr) ? ' next day' : ''),
      duration: D.fmtDur(f.dur),
      stops: f.stops,
      fare_per_person: f.fares[c],
      total_fare: f.fares[c] * pax
    }))
  };
}

async function createBooking(env, q) {
  const r = bookingRequest({ ...q, trip_type: q.return_date ? 'round_trip' : 'one_way' });
  const email = String(q.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 80) throw new HttpError(400, 'email is not a valid address.');
  const leg = (from, to, day, number) => {
    const f = D.flightsFor(from, to, day).find((x) => x.number === D.normalizeFlight(number));
    if (!f) throw new HttpError(404, `Flight ${number} does not fly ${from} to ${to} on ${day}.`);
    return { from, to, date: day, flight: f, fare: f.fares[r.cabin] };
  };
  const legs = [leg(r.from_airport, r.to_airport, r.depart_date, q.depart_flight)];
  if (r.return_date) legs.push(leg(r.to_airport, r.from_airport, r.return_date, q.return_flight));

  const s = await load(env);
  const pnr = D.newPnr(Object.values(s.bookings));
  s.bookings[pnr] = {
    pnr, firstName: r.first_name, lastName: r.last_name, email,
    cabin: r.cabin, pax: r.passengers, legs, source: 'chat', created: new Date().toISOString()
  };
  await save(env, s);
  return { booking_code: pnr, total_fare: legs.reduce((s, l) => s + l.fare, 0) * r.passengers };
}

/* An unknown code and a wrong last name get the same answer, so a caller cannot probe for codes. */
async function lookupBooking(env, q) {
  const pnr = String(q.booking_code || '').replace(/\s+/g, '').toUpperCase();
  const miss = new HttpError(404, 'No booking matches that code and last name.');
  if (!/^[A-Z0-9]{6}$/.test(pnr) || !fold(q.last_name)) throw miss;
  const b = (await load(env)).bookings[pnr];
  if (!b || fold(b.lastName) !== fold(q.last_name)) throw miss;
  const [out, back] = b.legs;
  return {
    booking_code: b.pnr,
    first_name: b.firstName,
    last_name: b.lastName,
    trip_type: back ? 'round_trip' : 'one_way',
    from_airport: out.from, from_city: D.cityOf(out.from),
    to_airport: out.to, to_city: D.cityOf(out.to),
    depart_date: out.date,
    depart_flight: out.flight.number,
    return_date: back ? back.date : '',
    return_flight: back ? back.flight.number : '',
    cabin: b.cabin,
    passengers: b.pax
  };
}

function keyOk(req, env) {
  const a = req.headers.get('x-api-key') || '';
  const b = env.AVA_API_KEY || '';
  if (!b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- Router ---------- */

async function route(req, env) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  const q = Object.fromEntries(url.searchParams);

  if (m === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });

  if (p.startsWith('/ava/')) {
    if (!keyOk(req, env)) throw new HttpError(401, 'Missing or wrong API key.');
    if (m === 'GET' && p === '/ava/destinations') return json(req, { destinations: D.AIRPORTS.map(([airport_code, city]) => ({ airport_code, city })) });
    if (m === 'POST' && p === '/ava/booking-request') return json(req, { inquiry_route: 'booking', ...bookingRequest(await body(req)) });
    if (m === 'GET' && p === '/ava/flights') return json(req, flights(q));
    if (m === 'POST' && p === '/ava/bookings') return json(req, await createBooking(env, await body(req)), 201);
    if (m === 'POST' && p === '/ava/booking-lookup') return json(req, await lookupBooking(env, await body(req)));
    throw new HttpError(404, 'No such route.');
  }

  if (m === 'GET' && p === '/api/state') return json(req, view(await load(env)));
  if (m === 'POST' && p === '/api/reset') return json(req, view(await save(env, seeded())));

  let hit = p.match(/^\/api\/bookings\/([A-Za-z0-9]{1,12})$/);
  if (hit) {
    const pnr = hit[1].toUpperCase();
    if (m === 'PUT') {
      const s = await load(env);
      if (q.create && s.bookings[pnr]) throw new HttpError(409, `Code ${pnr} is already used.`);
      const b = checkBooking(await body(req), pnr);
      s.bookings[pnr] = b;
      await save(env, s);
      return json(req, b);
    }
    if (m === 'DELETE') {
      const s = await load(env);
      delete s.bookings[pnr];
      await save(env, s);
      return json(req, { deleted: pnr });
    }
  }

  hit = p.match(/^\/api\/status\/(.{1,12})$/);
  if (hit) {
    const num = D.normalizeFlight(decodeURIComponent(hit[1]));
    if (!num) throw new HttpError(400, 'Enter a flight number like NW 123.');
    if (m === 'PUT') {
      const o = await body(req);
      if (!D.STATUSES.includes(o.status)) throw new HttpError(400, 'Unknown status.');
      const v = { status: o.status, delay: o.status === 'Delayed' ? Math.max(0, Math.min(1440, Number(o.delay) || 0)) : 0, gate: String(o.gate || '').trim().toUpperCase().slice(0, 4) };
      const s = await load(env);
      s.statusOverrides[num] = v;
      await save(env, s);
      return json(req, v);
    }
    if (m === 'DELETE') {
      const s = await load(env);
      delete s.statusOverrides[num];
      await save(env, s);
      return json(req, { deleted: num });
    }
  }

  throw new HttpError(404, 'No such route.');
}

export default {
  async fetch(req, env) {
    try {
      return await route(req, env);
    } catch (e) {
      if (e instanceof HttpError) return json(req, { error: e.message }, e.status);
      return json(req, { error: 'The booking store is unavailable. Try again shortly.' }, 503);
    }
  }
};
