(() => {
  'use strict';

  /* ---------- Helpers ---------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const D = window.NorthwindData;
  const {
    esc, money, AIRPORTS, CABIN_LABEL, CHANGE_FEE, cityOf,
    today, addDays, prettyDate, fmtTime, dayOffset, fmtDur, flightsFor
  } = D;

  /* ---------- Bookings and status overrides live in the booking API, shared with admin.html and the chat ---------- */

  const unavailable = (e) => showError(`${e.message} Please try again in a moment.`);

  /* ---------- Page elements ---------- */

  const results = $('#results');
  const bookForm = $('#panel-book');
  const faresForm = $('#panel-fares');
  const rebookForm = $('#panel-rebook');
  const statusForm = $('#panel-status');
  const tabs = $$('[role="tab"]');

  let siteTask = null;     // last tool submitted, sent to chat as site_last_task
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

  function sendSiteTask() {
    window.Genesys('command', 'Database.set', {
      messaging: { customAttributes: { site_last_task: siteTask } }
    });
  }

  // One of book, fares, rebook or status. The chat reads it as a hint only.
  function setSiteTask(name) {
    siteTask = name;
    if (window.Genesys) sendSiteTask();
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
    setSiteTask('book');

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

  async function onPassengerSubmit(form) {
    if (!form.checkValidity()) return form.reportValidity();
    const f = new FormData(form);
    const booking = {
      pnr: '',
      firstName: f.get('first').trim(),
      lastName: f.get('last').trim(),
      email: f.get('email').trim(),
      cabin: draft.cabin,
      pax: draft.pax,
      legs: draft.legs.map((l) => ({ ...l })),
      source: 'site'
    };
    form.querySelector('button[type="submit"]').disabled = true;
    try {
      const { bookings } = await D.load();
      for (let attempt = 0; ; attempt++) {
        booking.pnr = D.newPnr(bookings);
        try {
          await D.saveBooking(booking, true);
          break;
        } catch (e) {
          if (e.status !== 409 || attempt >= 2) throw e;
        }
      }
    } catch (e) {
      form.querySelector('button[type="submit"]').disabled = false;
      return unavailable(e);
    }
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

  rebookForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(rebookForm);
    const pnr = f.get('pnr').trim().toUpperCase();
    const last = f.get('last').trim().toLowerCase();
    setSiteTask('rebook');
    let bookings;
    try { ({ bookings } = await D.load()); } catch (err) { return unavailable(err); }
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
        <h2>Booking ${esc(b.pnr)}</h2>
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
    // A round trip stays in order: the outbound can't move past the return, nor the return before the outbound.
    const prev = activeBooking.legs[index - 1];
    const next = activeBooking.legs[index + 1];
    const minDate = prev && prev.date > today() ? prev.date : today();
    results.innerHTML = `
      <div class="results-head">
        <h2>Change flight</h2>
        <p>${esc(cityOf(leg.from))} to ${esc(cityOf(leg.to))}, currently ${prettyDate(leg.date)}</p>
      </div>
      <form id="change-form" class="card form-stack">
        <label>New date <input type="date" name="date" required min="${minDate}"${next ? ` max="${next.date}"` : ''} value="${leg.date}"></label>
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

  async function confirmChange(index) {
    const fl = changeFlights[index];
    let b;
    try {
      b = (await D.load()).bookings.find((x) => x.pnr === activeBooking.pnr);
      if (!b || !b.legs[changeIdx]) {
        activeBooking = null;
        return showError('This booking was changed or removed on the demo admin page. Look it up again.');
      }
      const leg = b.legs[changeIdx];
      leg.flight = fl;
      leg.date = changeDate;
      leg.fare = fl.fares[b.cabin];
      await D.saveBooking(b, false);
    } catch (e) {
      return unavailable(e);
    }
    showItinerary(b, `Flight changed. Your confirmation code is still ${b.pnr}.`);
  }

  /* ---------- Fares ---------- */

  faresForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(faresForm);
    const from = f.get('from');
    const to = f.get('to');
    const date = f.get('date');
    if (from === to) return showError('Choose two different airports.');
    setSiteTask('fares');

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

  /* ---------- Flight status (demo data, overridable on the admin page) ---------- */

  statusForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(statusForm);
    const num = D.normalizeFlight(f.get('number'));
    const date = f.get('date');
    if (!num) return showError('Enter a flight number like NW 123.');
    setSiteTask('status');

    let overrides;
    try { ({ statusOverrides: overrides } = await D.load()); } catch (err) { return unavailable(err); }
    const s = D.flightStatus(num, date, overrides);
    const cancelled = s.status === 'Cancelled';

    results.innerHTML = `
      <div class="results-head"><h2>Flight ${esc(num)}</h2><p>${prettyDate(date)}</p></div>
      <div class="card">
        <dl class="facts">
          <dt>Status</dt><dd>${esc(s.status)}</dd>
          <dt>Route</dt><dd>${esc(cityOf(s.from))} (${s.from}) to ${esc(cityOf(s.to))} (${s.to})</dd>
          <dt>Scheduled departure</dt><dd>${fmtTime(s.sched)}</dd>
          <dt>Estimated departure</dt><dd>${cancelled ? 'Cancelled' : fmtTime(s.sched + s.delay)}</dd>
          <dt>Gate</dt><dd>${cancelled ? 'None' : esc(s.gate)}</dd>
        </dl>
        ${cancelled ? '<p>This flight is cancelled. Chat with us or call to change your booking.</p>' : ''}
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
  // "Chat with us" is clicked, then opens. Deployment: LaunchPad-Airline, which
  // routes to Airline-IBMSG-General-Inquiry-Front-Door and only accepts
  // massimodifiore.github.io.
  const GENESYS = {
    url: 'https://apps.usw2.pure.cloud/genesys-bootstrap/genesys.min.js',
    environment: 'prod-usw2',
    deploymentId: '8e8be64b-879d-4898-b64a-4bf5d3209917'
  };

  const chatButton = $('#chat-toggle');
  const chatLabel = chatButton.textContent;
  $$('[data-chat-open]').forEach((b) => b.addEventListener('click', () => chatButton.click()));
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
    if (siteTask) sendSiteTask();

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
