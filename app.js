(() => {
  'use strict';

  /* ---------- Helpers ---------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
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

  /* ---------- Bookings (kept in memory for this page visit) ---------- */

  const bookings = [];

  function seedDemoBooking() {
    const date = addDays(today(), 10);
    const f = flightsFor('MIA', 'JFK', date)[1];
    bookings.push({
      pnr: 'DEMO01',
      firstName: 'Ana',
      lastName: 'Rivera',
      email: 'ana@example.com',
      cabin: 'Economy',
      pax: 1,
      legs: [{ from: 'MIA', to: 'JFK', date, flight: f, fare: f.fares.Economy }]
    });
  }
  seedDemoBooking();

  function newPnr() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
      code = '';
      for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    } while (bookings.some((b) => b.pnr === code));
    return code;
  }

  /* ---------- Page elements ---------- */

  const results = $('#results');
  const bookForm = $('#panel-book');
  const faresForm = $('#panel-fares');
  const rebookForm = $('#panel-rebook');
  const statusForm = $('#panel-status');
  const tabs = $$('[role="tab"]');

  let draft = null;        // booking in progress
  let activeBooking = null; // booking being changed
  let changeIdx = null;     // leg index being changed
  let changeDate = null;
  let changeFlights = [];

  /* ---------- Shared UI helpers ---------- */

  function showError(msg) {
    results.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'status error';
    p.setAttribute('role', 'alert');
    p.textContent = msg;
    results.appendChild(p);
  }

  function setStatus(el, text, kind) {
    el.textContent = text;
    el.className = 'status ' + (kind || '');
  }

  function setVal(form, name, value) {
    form.elements[name].value = value;
  }

  /* ---------- Tabs ---------- */

  function showTab(name) {
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    $$('.panel').forEach((p) => { p.hidden = p.id !== 'panel-' + name; });
  }

  tabs.forEach((t, i) => {
    t.addEventListener('click', () => showTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      showTab(next.dataset.tab);
    });
  });

  $$('[data-goto]').forEach((a) => a.addEventListener('click', () => showTab(a.dataset.goto)));

  /* ---------- Form setup ---------- */

  $$('select[data-airports]').forEach((s) => {
    s.innerHTML = AIRPORTS.map(([c, n]) => `<option value="${c}">${esc(n)} (${c})</option>`).join('');
  });

  const todayStr = today();
  $$('input[type="date"]').forEach((i) => { i.min = todayStr; });

  setVal(bookForm, 'from', 'MIA');
  setVal(bookForm, 'to', 'JFK');
  setVal(bookForm, 'depart', addDays(todayStr, 14));
  setVal(bookForm, 'return', addDays(todayStr, 21));
  setVal(faresForm, 'from', 'MIA');
  setVal(faresForm, 'to', 'LAX');
  setVal(faresForm, 'date', addDays(todayStr, 14));
  setVal(statusForm, 'date', todayStr);

  function syncTripType() {
    bookForm.elements.return.disabled = bookForm.elements.trip.value === 'oneway';
  }
  $$('input[name="trip"]', bookForm).forEach((r) => r.addEventListener('change', syncTripType));
  syncTripType();

  /* ---------- Shared flight rendering ---------- */

  function flightRow(fl, leg, cabin, index, action) {
    const price = fl.fares[cabin];
    const arrDay = dayOffset(fl.arr);
    return `
      <article class="flight">
        <div>
          <span class="time">${fmtTime(fl.dep)}</span>
          <span class="code">${esc(leg.from)}</span>
        </div>
        <div class="route">
          <span>${fmtDur(fl.dur)}</span>
          <span>${fl.stops ? '1 stop' : 'Nonstop'}</span>
          <span>${esc(fl.number)}</span>
        </div>
        <div>
          <span class="time">${fmtTime(fl.arr)}${arrDay ? ' +' + arrDay : ''}</span>
          <span class="code">${esc(leg.to)}</span>
        </div>
        <div class="stub">
          <span><strong>${money(price)}</strong> per person, ${esc(CABIN_LABEL[cabin])}</span>
          <button type="button" class="primary small" data-action="${action}" data-index="${index}">Select</button>
        </div>
      </article>`;
  }

  function legLine(l) {
    return `<p><strong>${esc(cityOf(l.from))} to ${esc(cityOf(l.to))}</strong>, ${prettyDate(l.date)}, flight ${esc(l.flight.number)}, departs ${fmtTime(l.flight.dep)} from ${esc(l.from)}</p>`;
  }

  /* ---------- Booking flow ---------- */

  bookForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(bookForm);
    const from = f.get('from');
    const to = f.get('to');
    const depart = f.get('depart');
    const roundTrip = f.get('trip') === 'round';
    const ret = roundTrip ? f.get('return') : null;

    if (from === to) return showError('Choose two different airports.');
    if (roundTrip && (!ret || ret < depart)) return showError('The return date needs to be on or after the depart date.');

    draft = {
      from, to, depart, ret,
      cabin: f.get('cabin'),
      pax: Number(f.get('pax')),
      legs: []
    };
    showFlights();
  });

  function legPlan(d) {
    const out = { from: d.from, to: d.to, date: d.depart };
    return d.ret ? [out, { from: d.to, to: d.from, date: d.ret }] : [out];
  }

  function showFlights() {
    const plan = legPlan(draft);
    const step = draft.legs.length;
    const leg = plan[step];
    draft.flights = flightsFor(leg.from, leg.to, leg.date);

    const heading = plan.length > 1 ? (step === 0 ? 'Outbound' : 'Return') : 'Flights';
    results.innerHTML = `
      <div class="results-head">
        <h2>${heading}: ${esc(cityOf(leg.from))} to ${esc(cityOf(leg.to))}</h2>
        <p>${prettyDate(leg.date)}, ${draft.pax} passenger${draft.pax > 1 ? 's' : ''}, ${esc(CABIN_LABEL[draft.cabin])}. Prices are per person.</p>
      </div>
      ${draft.flights.map((fl, i) => flightRow(fl, leg, draft.cabin, i, 'select')).join('')}`;
  }

  function onSelectFlight(index) {
    const plan = legPlan(draft);
    const step = draft.legs.length;
    const flight = draft.flights[index];
    draft.legs.push({
      from: plan[step].from,
      to: plan[step].to,
      date: plan[step].date,
      flight,
      fare: flight.fares[draft.cabin]
    });

    if (draft.legs.length < plan.length) showFlights();
    else showPassengerForm();
  }

  function showPassengerForm() {
    const total = draft.legs.reduce((s, l) => s + l.fare, 0) * draft.pax;
    results.innerHTML = `
      <div class="results-head"><h2>Passenger details</h2></div>
      <div class="card">
        ${draft.legs.map(legLine).join('')}
        <p class="total">Total for ${draft.pax} passenger${draft.pax > 1 ? 's' : ''}: <strong>${money(total)}</strong></p>
      </div>
      <form id="passenger-form" class="card form-stack">
        <p class="hint">Lead passenger. Demo only: no email is sent.</p>
        <div class="grid">
          <label>First name <input name="first" required autocomplete="given-name"></label>
          <label>Last name <input name="last" required autocomplete="family-name"></label>
          <label>Email <input name="email" type="email" required autocomplete="email"></label>
        </div>
        <div class="actions">
          <button class="primary" type="submit">Confirm booking</button>
          <button class="ghost" type="button" data-action="restart">Change flights</button>
        </div>
      </form>`;
    results.scrollIntoView({ block: 'start' });
  }

  function onPassengerSubmit(form) {
    if (!form.checkValidity()) return form.reportValidity();
    const f = new FormData(form);
    const booking = {
      pnr: newPnr(),
      firstName: f.get('first').trim(),
      lastName: f.get('last').trim(),
      email: f.get('email').trim(),
      cabin: draft.cabin,
      pax: draft.pax,
      legs: draft.legs.map((l) => ({ ...l }))
    };
    bookings.push(booking);
    draft = null;
    showConfirmation(booking);
  }

  function showConfirmation(b) {
    const total = b.legs.reduce((s, l) => s + l.fare, 0) * b.pax;
    results.innerHTML = `
      <div class="card">
        <h2>You are booked, ${esc(b.firstName)}.</h2>
        <p>Your confirmation code is <span class="pnr">${b.pnr}</span>. Keep it for changes and check-in.</p>
        ${b.legs.map(legLine).join('')}
        <p class="total">Total: <strong>${money(total)}</strong>. Demo only, so no payment was taken.</p>
        <p class="hint">Check-in opens 24 hours before departure.</p>
        <div class="actions">
          <button class="ghost" type="button" data-action="manage" data-pnr="${b.pnr}">Manage this booking</button>
        </div>
      </div>`;
    results.scrollIntoView({ block: 'start' });
  }

  /* ---------- Rebooking ---------- */

  rebookForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(rebookForm);
    const pnr = f.get('pnr').trim().toUpperCase();
    const last = f.get('last').trim().toLowerCase();
    const b = bookings.find((x) => x.pnr === pnr && x.lastName.toLowerCase() === last);
    if (!b) {
      return showError("We couldn't find a booking with that code and last name. Check both and try again. For the demo, use DEMO01 and Rivera.");
    }
    showItinerary(b);
  });

  function showItinerary(b, notice) {
    activeBooking = b;
    results.innerHTML = `
      ${notice ? `<p class="status ok" role="status">${esc(notice)}</p>` : ''}
      <div class="results-head">
        <h2>Booking ${b.pnr}</h2>
        <p>${esc(b.firstName)} ${esc(b.lastName)}, ${b.pax} passenger${b.pax > 1 ? 's' : ''}, ${esc(CABIN_LABEL[b.cabin])}</p>
      </div>
      ${b.legs.map((l, i) => `
        <div class="card">
          ${legLine(l)}
          <div class="actions">
            <button class="ghost small" type="button" data-action="change-leg" data-index="${i}">Change this flight</button>
          </div>
        </div>`).join('')}`;
    results.scrollIntoView({ block: 'start' });
  }

  function startChange(index) {
    const leg = activeBooking.legs[index];
    changeIdx = index;
    results.innerHTML = `
      <div class="results-head">
        <h2>Change flight</h2>
        <p>${esc(cityOf(leg.from))} to ${esc(cityOf(leg.to))}, currently ${prettyDate(leg.date)}</p>
      </div>
      <form id="change-form" class="card form-stack">
        <label>New date <input type="date" name="date" required min="${today()}" value="${leg.date}"></label>
        <p class="hint">Economy and Premium changes cost $75 per person, plus any fare difference. Business changes have no change fee.</p>
        <div class="actions"><button class="primary" type="submit">Show flights</button></div>
      </form>
      <div id="change-results"></div>`;
  }

  function onChangeSubmit(form) {
    if (!form.checkValidity()) return form.reportValidity();
    const leg = activeBooking.legs[changeIdx];
    changeDate = new FormData(form).get('date');
    changeFlights = flightsFor(leg.from, leg.to, changeDate);
    $('#change-results').innerHTML = changeFlights
      .map((fl, i) => flightRow(fl, { from: leg.from, to: leg.to }, activeBooking.cabin, i, 'rebook-select'))
      .join('');
  }

  function onRebookSelect(index) {
    const leg = activeBooking.legs[changeIdx];
    const fl = changeFlights[index];
    const newFare = fl.fares[activeBooking.cabin];
    const diff = Math.max(0, newFare - leg.fare) * activeBooking.pax;
    const fee = CHANGE_FEE[activeBooking.cabin] * activeBooking.pax;
    const due = diff + fee;

    results.innerHTML = `
      <div class="results-head"><h2>Review change</h2></div>
      <div class="card">
        <p><strong>Current flight:</strong> ${esc(leg.flight.number)}, ${prettyDate(leg.date)}, departs ${fmtTime(leg.flight.dep)}</p>
        <p><strong>New flight:</strong> ${esc(fl.number)}, ${prettyDate(changeDate)}, departs ${fmtTime(fl.dep)}</p>
        <p>Fare difference: ${money(diff)}</p>
        <p>Change fee: ${money(fee)}</p>
        <p class="total">Amount due: <strong>${money(due)}</strong></p>
        <p class="hint">Demo only. No payment is taken.</p>
        <div class="actions">
          <button class="primary" type="button" data-action="confirm-change" data-index="${index}">Confirm change</button>
          <button class="ghost" type="button" data-action="change-leg" data-index="${changeIdx}">Back</button>
        </div>
      </div>`;
  }

  function confirmChange(index) {
    const fl = changeFlights[index];
    const leg = activeBooking.legs[changeIdx];
    leg.flight = fl;
    leg.date = changeDate;
    leg.fare = fl.fares[activeBooking.cabin];
    showItinerary(activeBooking, `Flight changed. Your confirmation code is still ${activeBooking.pnr}.`);
  }

  /* ---------- Fares ---------- */

  faresForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(faresForm);
    const from = f.get('from');
    const to = f.get('to');
    const date = f.get('date');
    if (from === to) return showError('Choose two different airports.');

    const rows = [-3, -2, -1, 0, 1, 2, 3]
      .map((k) => addDays(date, k))
      .filter((d) => d >= today())
      .map((d) => {
        const fl = flightsFor(from, to, d);
        const low = (c) => Math.min(...fl.map((x) => x.fares[c]));
        return { d, Economy: low('Economy'), Premium: low('Premium'), Business: low('Business') };
      });

    results.innerHTML = `
      <div class="results-head">
        <h2>Lowest fares: ${esc(cityOf(from))} to ${esc(cityOf(to))}</h2>
        <p>Seven days around ${prettyDate(date)}. Prices are per person, one way.</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Economy</th>
              <th scope="col">Premium</th>
              <th scope="col">Business</th>
              <th scope="col"><span class="sr">Action</span></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <th scope="row">${prettyDate(r.d)}</th>
                <td>${money(r.Economy)}</td>
                <td>${money(r.Premium)}</td>
                <td>${money(r.Business)}</td>
                <td><button class="ghost small" type="button" data-action="book-date" data-from="${esc(from)}" data-to="${esc(to)}" data-date="${r.d}">Book this date</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  });

  /* ---------- Flight status (demo data) ---------- */

  statusForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(statusForm);
    let num = f.get('number').trim().toUpperCase().replace(/\s+/g, ' ');
    num = num.replace(/^([A-Z]{2})\s?(\d{1,4})$/, '$1 $2');
    const date = f.get('date');
    if (!/^[A-Z]{2} \d{1,4}$/.test(num)) return showError('Enter a flight number like NW 123.');

    const r = rng(hash(num + '|' + date));
    const states = [['On time', 0], ['On time', 0], ['Delayed', 15], ['Delayed', 40], ['Boarding', 0], ['Departed', 0], ['Landed', 0]];
    const [status, delay] = states[Math.floor(r() * states.length)];
    const sched = 360 + Math.floor((r() * 960) / 5) * 5;
    const from = AIRPORTS[Math.floor(r() * AIRPORTS.length)][0];
    let to = from;
    while (to === from) to = AIRPORTS[Math.floor(r() * AIRPORTS.length)][0];
    const gate = String.fromCharCode(65 + Math.floor(r() * 6)) + (1 + Math.floor(r() * 30));

    results.innerHTML = `
      <div class="results-head"><h2>Flight ${esc(num)}</h2><p>${prettyDate(date)}</p></div>
      <div class="card">
        <dl class="facts">
          <dt>Status</dt><dd>${esc(status)}</dd>
          <dt>Route</dt><dd>${esc(cityOf(from))} (${from}) to ${esc(cityOf(to))} (${to})</dd>
          <dt>Scheduled departure</dt><dd>${fmtTime(sched)}</dd>
          <dt>Estimated departure</dt><dd>${fmtTime(sched + delay)}</dd>
          <dt>Gate</dt><dd>${gate}</dd>
        </dl>
        <p class="hint">Demo data. Live flight tracking is not connected to this site.</p>
      </div>`;
  });

  /* ---------- Results area: delegated clicks and submits ---------- */

  results.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const idx = Number(btn.dataset.index);
    switch (btn.dataset.action) {
      case 'select': return onSelectFlight(idx);
      case 'restart': draft = null; return bookForm.requestSubmit();
      case 'manage':
        showTab('rebook');
        setVal(rebookForm, 'pnr', btn.dataset.pnr);
        return rebookForm.elements.last.focus();
      case 'change-leg': return startChange(idx);
      case 'rebook-select': return onRebookSelect(idx);
      case 'confirm-change': return confirmChange(idx);
      case 'book-date':
        setVal(bookForm, 'from', btn.dataset.from);
        setVal(bookForm, 'to', btn.dataset.to);
        setVal(bookForm, 'depart', btn.dataset.date);
        showTab('book');
        return bookForm.elements.depart.focus();
      default: return;
    }
  });

  results.addEventListener('submit', (e) => {
    if (e.target.id === 'passenger-form') {
      e.preventDefault();
      onPassengerSubmit(e.target);
    } else if (e.target.id === 'change-form') {
      e.preventDefault();
      onChangeSubmit(e.target);
    }
  });

  /* ---------- Contact forms (demo only, nothing is sent) ---------- */

  const emailForm = $('#email-form');
  emailForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!emailForm.checkValidity()) return emailForm.reportValidity();
    const name = new FormData(emailForm).get('name').trim();
    const ref = 'CS-' + (10000 + Math.floor(Math.random() * 90000));
    setStatus($('#email-status'),
      `Thanks, ${name}. Your reference is ${ref}. A specialist replies within one business day. (Demo: nothing was sent.)`, 'ok');
    emailForm.reset();
  });

  const callbackForm = $('#callback-form');
  callbackForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!callbackForm.checkValidity()) return callbackForm.reportValidity();
    const f = new FormData(callbackForm);
    setStatus($('#callback-status'),
      `Got it, ${f.get('name').trim()}. We will call you at ${f.get('phone')}, ${f.get('when').toLowerCase()}. (Demo: no call is placed.)`, 'ok');
    callbackForm.reset();
  });

  /* ---------- Chat: Genesys Cloud Web Messenger (loads on demand) ---------- */

  // The messenger script is not loaded on page load. It loads the first time
  // "Chat with us" is clicked, then opens. Deployment: edd3cf4f-ba14-4251-9fd5-857308e8ef38
  const GENESYS = {
    url: 'https://apps.usw2.pure.cloud/genesys-bootstrap/genesys.min.js',
    environment: 'usw2',
    deploymentId: 'edd3cf4f-ba14-4251-9fd5-857308e8ef38'
  };

  const chatButton = $('#chat-toggle');
  const chatLabel = chatButton.textContent;
  let messengerRequested = false;
  let messengerReady = false;

  const showChatUnavailable = () => {
    chatButton.disabled = false;
    chatButton.textContent = chatLabel;
    showError('Chat is not available right now. Please try again in a moment, or call +1 (800) 555-0142.');
    document.getElementById('help').scrollIntoView({ behavior: 'smooth' });
  };

  const openMessenger = () => {
    chatButton.disabled = false;
    chatButton.textContent = chatLabel;
    window.Genesys('command', 'Messenger.open', {}, () => {}, showChatUnavailable);
  };

  function loadMessenger() {
    messengerRequested = true;

    // Same queue stub the Genesys bootstrap snippet creates.
    window._genesysJs = 'Genesys';
    window.Genesys = window.Genesys || function () {
      (window.Genesys.q = window.Genesys.q || []).push(arguments);
    };
    window.Genesys.t = 1 * new Date();
    window.Genesys.c = { environment: GENESYS.environment, deploymentId: GENESYS.deploymentId };

    window.Genesys('subscribe', 'Messenger.ready', () => {
      messengerReady = true;
      openMessenger();
    });

    const script = document.createElement('script');
    script.async = true;
    script.charset = 'utf-8';
    script.src = GENESYS.url;
    script.onerror = showChatUnavailable;
    document.head.appendChild(script);
  }

  chatButton.addEventListener('click', () => {
    if (messengerReady) return openMessenger();
    chatButton.disabled = true;
    chatButton.textContent = 'Opening chat...';
    if (!messengerRequested) loadMessenger();
  });

  /* ---------- Start ---------- */

  showTab('book');
})();
