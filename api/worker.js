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
  const words = (s) => ` ${fold(s).replace(/[^a-z'-]+/g, ' ').trim()} `;
  if (!b || !words(q.last_name).includes(words(b.lastName))) throw miss;
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

/* ---------- Callbacks: Genesys Cloud ACD callbacks on the Airline queue ----------
   Open hours match the Airline-General-Inquiry-Hours schedule: every day 06:00-23:00 New York time. */

const TZ = 'America/New_York';
const OPEN_HOUR = 6;
const CLOSE_HOUR = 23;
const REASONS = ['new_booking', 'change_trip', 'flight_status', 'other'];

function nyParts(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}

function nyToUtc(y, mo, d, h, mi) {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (ms) => { const p = nyParts(ms); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(ms / 60000) * 60000; };
  const first = wall - offset(wall);
  return wall - offset(first);
}

const nyLabel = (ms) => new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
}).format(new Date(ms)) + ' New York time';

function phoneE164(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/[\s().-]/g, '');
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^\d{10}$/.test(digits)) return '+1' + digits;
  if (/^1\d{10}$/.test(digits)) return '+' + digits;
  throw new HttpError(400, 'Enter a phone number with its area code, such as 305 555 0123, or in international format, such as +44 20 7946 0000.');
}

/* Returns the UTC time to schedule, or null to call as soon as possible. */
function callbackTime(when) {
  const now = Date.now();
  if (String(when || 'asap') === 'asap') {
    const n = nyParts(now);
    if (n.h >= OPEN_HOUR && n.h < CLOSE_HOUR) return null;
    const t = new Date(Date.UTC(n.y, n.mo - 1, n.d + (n.h >= CLOSE_HOUR ? 1 : 0)));
    return nyToUtc(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), OPEN_HOUR, 0);
  }
  const m = String(when).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) throw new HttpError(400, 'when must be asap or a New York time like 2026-12-01T10:30.');
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (h < OPEN_HOUR || h >= CLOSE_HOUR || (mi !== 0 && mi !== 30)) {
    throw new HttpError(400, 'Choose a time on the hour or half hour between 6:00 am and 10:30 pm New York time.');
  }
  const t = nyToUtc(y, mo, d, h, mi);
  if (t <= now) throw new HttpError(400, 'That time has already passed. Choose a later time.');
  if (t > now + 7 * 86400000) throw new HttpError(400, 'Choose a time within the next 7 days.');
  return t;
}

let gcToken = null;

async function gcAccessToken(env, failMessage) {
  if (gcToken && gcToken.expires > Date.now() + 60000) return gcToken.value;
  const r = await fetch(`https://login.${env.GC_ENV}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + btoa(`${env.GC_CLIENT_ID}:${env.GC_CLIENT_SECRET}`) },
    body: 'grant_type=client_credentials'
  });
  if (!r.ok) { console.log('gc token failed', r.status); throw new HttpError(502, failMessage); }
  const t = await r.json();
  gcToken = { value: t.access_token, expires: Date.now() + t.expires_in * 1000 };
  return gcToken.value;
}

async function requestCallback(req, env, o) {
  if (!ORIGINS.includes(req.headers.get('origin'))) throw new HttpError(403, 'Callbacks can be requested only from the Northwind Air website.');
  const caller = String(o.name || '').trim();
  if (!caller || caller.length > 60) throw new HttpError(400, 'Name is required, up to 60 characters.');
  const phone = phoneE164(o.phone);
  const reason = o.reason ? String(o.reason) : '';
  if (reason && !REASONS.includes(reason)) throw new HttpError(400, 'Unknown reason.');
  const code = String(o.booking_code || '').trim().toUpperCase();
  if (code && !/^[A-Z0-9]{6}$/.test(code)) throw new HttpError(400, 'A booking code has 6 letters or digits, such as DEMO01.');
  const at = callbackTime(o.when);
  if (!env.GC_CLIENT_ID || !env.GC_CLIENT_SECRET) throw new HttpError(503, 'Callbacks are not set up yet. Please call us instead.');

  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const ipKey = `cb:ip:${ip}`;
  const phoneKey = `cb:phone:${phone}`;
  const ipCount = Number(await env.BOOKINGS.get(ipKey)) || 0;
  if (ipCount >= 3) throw new HttpError(429, 'Too many callback requests from this device. Try again in an hour or call us.');
  if (await env.BOOKINGS.get(phoneKey)) throw new HttpError(429, 'A callback to this number was requested in the last hour. We will call you.');
  await env.BOOKINGS.put(ipKey, String(ipCount + 1), { expirationTtl: 3600 });

  const data = { callback_source: 'website' };
  if (reason) data.callback_reason = reason;
  if (code) data.booking_code = code;
  const r = await fetch(`https://api.${env.GC_ENV}/api/v2/conversations/callbacks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await gcAccessToken(env, 'We could not schedule the callback. Please call us instead.') },
    body: JSON.stringify({
      routingData: { queueId: env.GC_QUEUE_ID },
      callbackNumbers: [phone],
      callbackUserName: caller,
      ...(at ? { callbackScheduledTime: new Date(at).toISOString() } : {}),
      countryCode: 'US',
      validateCallbackNumbers: true,
      data
    })
  });
  if (!r.ok) {
    console.log('gc callback failed', r.status, (await r.text()).slice(0, 300));
    throw new HttpError(502, 'We could not schedule the callback. Please call us instead.');
  }
  const conv = (await r.json()).conversation || {};
  await env.BOOKINGS.put(phoneKey, '1', { expirationTtl: 3600 });
  return {
    reference: 'CB-' + String(conv.id || '').replace(/-/g, '').slice(-6).toUpperCase(),
    phone,
    scheduled_for_utc: at ? new Date(at).toISOString() : null,
    scheduled_for_local: at ? nyLabel(at) : 'as soon as possible'
  };
}

/* ---------- Website messages: third-party Genesys Cloud emails on the Airline queue ---------- */

const TOPICS = ['Booking', 'Fares', 'Changing a booking', 'Flight status', 'Refund', 'Other'];

async function sendMessage(req, env, o) {
  if (!ORIGINS.includes(req.headers.get('origin'))) throw new HttpError(403, 'Messages can be sent only from the Northwind Air website.');
  const name = String(o.name || '').trim();
  if (!name || name.length > 60) throw new HttpError(400, 'Name is required, up to 60 characters.');
  const email = String(o.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 80) throw new HttpError(400, 'Enter a valid email address.');
  const topic = String(o.topic || 'Other');
  if (!TOPICS.includes(topic)) throw new HttpError(400, 'Unknown topic.');
  const code = String(o.booking_code || '').replace(/\s+/g, '').toUpperCase();
  if (code && !/^[A-Z0-9]{6}$/.test(code)) throw new HttpError(400, 'A booking code has 6 letters or digits, such as DEMO01.');
  const message = String(o.message || '').trim();
  if (message.length < 10 || message.length > 2000) throw new HttpError(400, 'The message must be 10 to 2000 characters.');
  if (!env.GC_CLIENT_ID || !env.GC_CLIENT_SECRET) throw new HttpError(503, 'Messages are not set up yet. Please call or chat with us instead.');

  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const ipKey = `em:ip:${ip}`;
  const addrKey = `em:addr:${email}`;
  const ipCount = Number(await env.BOOKINGS.get(ipKey)) || 0;
  const addrCount = Number(await env.BOOKINGS.get(addrKey)) || 0;
  if (ipCount >= 3) throw new HttpError(429, 'Too many messages from this device. Try again in an hour or chat with us.');
  if (addrCount >= 2) throw new HttpError(429, 'We already have two messages from this address in the last hour. A specialist will reply.');
  await env.BOOKINGS.put(ipKey, String(ipCount + 1), { expirationTtl: 3600 });

  const fail = 'We could not send your message. Please call or chat with us instead.';
  const r = await fetch(`https://api.${env.GC_ENV}/api/v2/conversations/emails`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await gcAccessToken(env, fail) },
    body: JSON.stringify({
      queueId: env.GC_QUEUE_ID,
      provider: 'Northwind Air Website',
      direction: 'INBOUND',
      fromName: name,
      fromAddress: email,
      subject: `${topic}${code ? ` (booking ${code})` : ''}: website message from ${name}`,
      textBody: `${message}\n\nName: ${name}\nEmail: ${email}\nTopic: ${topic}\nBooking code: ${code || 'not given'}\nSent from the Northwind Air website contact form.`,
      attributes: { email_source: 'website', email_topic: topic, ...(code ? { booking_code: code } : {}) }
    })
  });
  if (!r.ok) {
    console.log('gc email failed', r.status, (await r.text()).slice(0, 300));
    throw new HttpError(502, fail);
  }
  const conv = await r.json();
  await env.BOOKINGS.put(addrKey, String(addrCount + 1), { expirationTtl: 3600 });
  return { reference: 'EM-' + String(conv.id || '').replace(/-/g, '').slice(-6).toUpperCase() };
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
  if (m === 'POST' && p === '/api/callbacks') return json(req, await requestCallback(req, env, await body(req)), 201);
  if (m === 'POST' && p === '/api/messages') return json(req, await sendMessage(req, env, await body(req)), 201);

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
