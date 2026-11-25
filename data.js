/* Shared by the site (app.js) and the demo admin page (admin.js). */
window.NorthwindData = (() => {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

  /* ---------- Reference data (demo only) ---------- */

  const AIRPORTS = [
    ['MIA', 'Miami'], ['JFK', 'New York'], ['ORD', 'Chicago'], ['LAX', 'Los Angeles'],
    ['SFO', 'San Francisco'], ['MEX', 'Mexico City'], ['LHR', 'London'], ['CDG', 'Paris'],
    ['GRU', 'São Paulo']
  ];
  const CABIN_MULT = { Economy: 1, Premium: 1.6, Business: 3.2 };
  const CABIN_LABEL = { Economy: 'Economy', Premium: 'Premium Economy', Business: 'Business' };
  const CHANGE_FEE = { Economy: 75, Premium: 75, Business: 0 };
  const STATUSES = ['On time', 'Delayed', 'Boarding', 'Departed', 'Landed', 'Cancelled'];
  const cityOf = (code) => (AIRPORTS.find((a) => a[0] === code) || [code, code])[1];

  /* ---------- Dates (local time, YYYY-MM-DD) ---------- */

  const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => toISO(new Date());
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d); };
  const prettyDate = (s) => parseISO(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  /* Times are minutes after midnight. Values past 1440 roll into the next day. */
  const fmtTime = (min) => {
    const m = ((min % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  };
  const dayOffset = (min) => Math.floor(min / 1440);
  const fmtDur = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;

  /* ---------- Deterministic demo data ---------- */

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function rng(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* The same route and date always return the same flights. */
  function flightsFor(from, to, date) {
    const r = rng(hash(`${from}>${to}|${date}`));
    const base = 110 + Math.floor(r() * 200);
    const slots = [400, 585, 760, 945, 1130, 1290]
      .map((v) => [r(), v])
      .sort((a, b) => a[0] - b[0])
      .slice(0, 4)
      .map((x) => x[1])
      .sort((a, b) => a - b);

    return slots.map((dep) => {
      const dur = 180 + Math.round((r() * 360) / 5) * 5;
      const econ = Math.round((base * (0.85 + r() * 0.5)) / 5) * 5;
      return {
        number: 'NW ' + (100 + Math.floor(r() * 899)),
        dep,
        arr: dep + dur,
        dur,
        stops: r() < 0.65 ? 0 : 1,
        fares: Object.fromEntries(
          Object.entries(CABIN_MULT).map(([k, m]) => [k, Math.round((econ * m) / 5) * 5])
        )
      };
    });
  }

  function newPnr(bookings) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
      code = '';
      for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    } while (bookings.some((b) => b.pnr === code));
    return code;
  }

  /* Returns "NW 123" for inputs like "nw123", or null when it is not a flight number. */
  function normalizeFlight(input) {
    const num = String(input).trim().toUpperCase().replace(/\s+/g, ' ')
      .replace(/^([A-Z]{2})\s?(\d{1,4})$/, '$1 $2');
    return /^[A-Z]{2} \d{1,4}$/.test(num) ? num : null;
  }

  /* ---------- Store (this browser only) ---------- */

  const KEY = 'northwind-demo-v1';

  function seed() {
    const date = addDays(today(), 10);
    const f = flightsFor('MIA', 'JFK', date)[1];
    return {
      bookings: [{
        pnr: 'DEMO01',
        firstName: 'Ana',
        lastName: 'Rivera',
        email: 'ana@example.com',
        cabin: 'Economy',
        pax: 1,
        legs: [{ from: 'MIA', to: 'JFK', date, flight: f, fare: f.fares.Economy }]
      }],
      statusOverrides: {}
    };
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.bookings) && s.statusOverrides && typeof s.statusOverrides === 'object') return s;
    } catch (e) { /* unreadable: fall back to the seed */ }
    return save(seed());
  }

  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: keep in memory */ }
    return state;
  }

  const reset = () => save(seed());

  /* An override from the admin page wins over the generated status, on every date. */
  function flightStatus(number, date, overrides) {
    const r = rng(hash(number + '|' + date));
    const states = [['On time', 0], ['On time', 0], ['Delayed', 15], ['Delayed', 40], ['Boarding', 0], ['Departed', 0], ['Landed', 0]];
    const [status, delay] = states[Math.floor(r() * states.length)];
    const sched = 360 + Math.floor((r() * 960) / 5) * 5;
    const from = AIRPORTS[Math.floor(r() * AIRPORTS.length)][0];
    let to = from;
    while (to === from) to = AIRPORTS[Math.floor(r() * AIRPORTS.length)][0];
    const gate = String.fromCharCode(65 + Math.floor(r() * 6)) + (1 + Math.floor(r() * 30));

    const o = (overrides || {})[number];
    if (!o) return { status, delay, sched, from, to, gate, overridden: false };
    return {
      status: o.status,
      delay: o.status === 'Delayed' ? Number(o.delay) || 0 : 0,
      sched, from, to,
      gate: o.gate || gate,
      overridden: true
    };
  }

  return {
    KEY, esc, money,
    AIRPORTS, CABIN_MULT, CABIN_LABEL, CHANGE_FEE, STATUSES, cityOf,
    today, addDays, prettyDate, fmtTime, dayOffset, fmtDur,
    hash, rng, flightsFor, newPnr, normalizeFlight,
    load, save, reset, flightStatus
  };
})();
