(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const D = window.NorthwindData;
  const { esc, money, AIRPORTS, CABIN_LABEL, STATUSES, today, addDays, prettyDate, fmtTime, flightsFor } = D;

  let state = D.load();
  const saveState = () => D.save(state);

  function setStatus(el, text, kind) {
    el.textContent = text;
    el.className = 'status ' + (kind || '');
  }

  /* ---------- Bookings table ---------- */

  const rows = $('#booking-rows');
  const bookingsStatus = $('#bookings-status');

  function renderBookings() {
    if (!state.bookings.length) {
      rows.innerHTML = '<tr><td colspan="6">No bookings. Create one, or reset to restore DEMO01.</td></tr>';
      return;
    }
    rows.innerHTML = state.bookings.map((b) => `
      <tr>
        <th scope="row"><span class="pnr">${esc(b.pnr)}</span></th>
        <td>${esc(b.firstName)} ${esc(b.lastName)}<br><span class="code">${esc(b.email)}</span></td>
        <td class="legs">${b.legs.map((l) => `<span>${esc(l.flight.number)}: ${esc(l.from)} to ${esc(l.to)}, ${prettyDate(l.date)}, ${fmtTime(l.flight.dep)}</span>`).join('')}</td>
        <td>${esc(CABIN_LABEL[b.cabin])}</td>
        <td>${b.pax}</td>
        <td>
          <div class="row-actions">
            <button class="ghost small" type="button" data-action="edit" data-pnr="${esc(b.pnr)}">Edit</button>
            <button class="ghost small" type="button" data-action="delete" data-pnr="${esc(b.pnr)}">Delete</button>
          </div>
        </td>
      </tr>`).join('');
  }

  rows.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const b = state.bookings.find((x) => x.pnr === btn.dataset.pnr);
    if (!b) return;
    if (btn.dataset.action === 'edit') return openForm(b);
    if (btn.dataset.action === 'delete' && window.confirm(`Delete booking ${b.pnr}?`)) {
      state.bookings = state.bookings.filter((x) => x !== b);
      saveState();
      if (editing === b.pnr) closeForm();
      renderAll();
      setStatus(bookingsStatus, `Booking ${b.pnr} deleted.`, 'ok');
    }
  });

  /* ---------- Booking form (create and edit) ---------- */

  const form = $('#booking-form');
  const formStatus = $('#booking-form-status');
  const el = form.elements;
  let editing = null;       // code of the booking being edited, or null for a new one
  let outFlights = [];
  let retFlights = [];

  $$('select[data-airports]', form).forEach((s) => {
    s.innerHTML = AIRPORTS.map(([c, n]) => `<option value="${c}">${esc(n)} (${c})</option>`).join('');
  });
  el.depart.min = today();
  el.return.min = today();

  const roundTrip = () => el.trip.value === 'round';

  function flightOptions(list, cabin) {
    return list.map((f, i) =>
      `<option value="${i}">${esc(f.number)}, departs ${fmtTime(f.dep)}, ${money(f.fares[cabin])} per person</option>`).join('');
  }

  /* Rebuilds the flight lists for the chosen route and dates, keeping the chosen flight where it still exists. */
  function refreshFlights(keepOut, keepRet) {
    const cabin = el.cabin.value;
    const pick = (list, keep) => Math.max(0, list.findIndex((f) => keep && f.number === keep.number && f.dep === keep.dep));
    const prevOut = keepOut || outFlights[el.outFlight.value];
    const prevRet = keepRet || retFlights[el.retFlight.value];

    outFlights = el.depart.value ? flightsFor(el.from.value, el.to.value, el.depart.value) : [];
    el.outFlight.innerHTML = flightOptions(outFlights, cabin);
    el.outFlight.value = String(pick(outFlights, prevOut));

    const rt = roundTrip();
    el.return.disabled = !rt;
    el.return.required = rt;
    el.retFlight.disabled = !rt;
    retFlights = rt && el.return.value ? flightsFor(el.to.value, el.from.value, el.return.value) : [];
    el.retFlight.innerHTML = flightOptions(retFlights, cabin);
    el.retFlight.value = String(pick(retFlights, prevRet));
  }

  ['from', 'to', 'depart', 'return', 'cabin'].forEach((n) => el[n].addEventListener('change', () => refreshFlights()));
  $$('input[name="trip"]', form).forEach((r) => r.addEventListener('change', () => refreshFlights()));

  function openForm(b) {
    editing = b ? b.pnr : null;
    form.reset();
    setStatus(formStatus, '');
    $('#booking-form-title').textContent = b ? `Edit booking ${b.pnr}` : 'New booking';
    el.pnr.readOnly = Boolean(b);

    if (b) {
      const [out, ret] = b.legs;
      el.pnr.value = b.pnr;
      el.first.value = b.firstName;
      el.last.value = b.lastName;
      el.email.value = b.email;
      el.cabin.value = b.cabin;
      el.pax.value = String(b.pax);
      el.trip.value = ret ? 'round' : 'oneway';
      el.from.value = out.from;
      el.to.value = out.to;
      el.depart.value = out.date;
      el.return.value = ret ? ret.date : addDays(out.date, 7);
      outFlights = [];
      retFlights = [];
      refreshFlights(out.flight, ret && ret.flight);
    } else {
      el.from.value = 'MIA';
      el.to.value = 'JFK';
      el.depart.value = addDays(today(), 7);
      el.return.value = addDays(today(), 14);
      outFlights = [];
      retFlights = [];
      refreshFlights();
    }
    form.hidden = false;
    form.scrollIntoView({ block: 'start' });
    (b ? el.first : el.pnr).focus();
  }

  function closeForm() {
    editing = null;
    form.hidden = true;
  }

  $('#new-booking').addEventListener('click', () => openForm(null));
  $('#cancel-booking').addEventListener('click', closeForm);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.checkValidity()) return form.reportValidity();
    const rt = roundTrip();
    if (el.from.value === el.to.value) return setStatus(formStatus, 'Choose two different airports.', 'error');
    if (rt && el.return.value < el.depart.value) return setStatus(formStatus, 'The return date needs to be on or after the depart date.', 'error');

    state = D.load();
    const code = el.pnr.value.trim().toUpperCase();
    if (!editing && code && state.bookings.some((b) => b.pnr === code)) {
      return setStatus(formStatus, `Code ${code} is already used. Choose another, or leave it empty to generate one.`, 'error');
    }

    const cabin = el.cabin.value;
    const leg = (from, to, date, flight) => ({ from, to, date, flight, fare: flight.fares[cabin] });
    const legs = [leg(el.from.value, el.to.value, el.depart.value, outFlights[el.outFlight.value])];
    if (rt) legs.push(leg(el.to.value, el.from.value, el.return.value, retFlights[el.retFlight.value]));

    const booking = {
      pnr: editing || code || D.newPnr(state.bookings),
      firstName: el.first.value.trim(),
      lastName: el.last.value.trim(),
      email: el.email.value.trim(),
      cabin,
      pax: Number(el.pax.value),
      legs
    };

    const i = state.bookings.findIndex((b) => b.pnr === booking.pnr);
    if (i >= 0) state.bookings[i] = booking;
    else state.bookings.push(booking);
    saveState();

    const verb = editing ? 'updated' : 'created';
    closeForm();
    renderAll();
    setStatus(bookingsStatus, `Booking ${booking.pnr} ${verb} for ${booking.firstName} ${booking.lastName}. On the site, use Rebook with code ${booking.pnr} and last name ${booking.lastName}.`, 'ok');
  });

  /* ---------- Flight status overrides ---------- */

  const statusForm = $('#status-form');
  const statusFormStatus = $('#status-form-status');
  const statusRows = $('#status-rows');
  $('#status-select').innerHTML = STATUSES.map((s) => `<option>${esc(s)}</option>`).join('');

  function renderStatuses() {
    const entries = Object.entries(state.statusOverrides).sort((a, b) => a[0].localeCompare(b[0]));
    statusRows.innerHTML = entries.length
      ? entries.map(([num, o]) => `
        <tr>
          <th scope="row">${esc(num)}</th>
          <td>${esc(o.status)}</td>
          <td>${o.status === 'Delayed' ? `${Number(o.delay) || 0} min` : ''}</td>
          <td>${esc(o.gate || 'Generated')}</td>
          <td><div class="row-actions"><button class="ghost small" type="button" data-num="${esc(num)}">Remove</button></div></td>
        </tr>`).join('')
      : '<tr><td colspan="5">No overrides. Every flight shows generated demo data.</td></tr>';

    const booked = [...new Set(state.bookings.flatMap((b) => b.legs.map((l) => l.flight.number)))];
    $('#booked-flights').innerHTML = booked.map((n) => `<option value="${esc(n)}"></option>`).join('');
  }

  statusForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!statusForm.checkValidity()) return statusForm.reportValidity();
    const f = new FormData(statusForm);
    const num = D.normalizeFlight(f.get('number'));
    if (!num) return setStatus(statusFormStatus, 'Enter a flight number like NW 123.', 'error');
    const status = f.get('status');
    state = D.load();
    state.statusOverrides[num] = {
      status,
      delay: status === 'Delayed' ? Number(f.get('delay')) || 0 : 0,
      gate: f.get('gate').trim().toUpperCase()
    };
    saveState();
    renderStatuses();
    statusForm.reset();
    setStatus(statusFormStatus, `${num} now shows ${status} on the Flight status tab.`, 'ok');
  });

  statusRows.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state = D.load();
    delete state.statusOverrides[btn.dataset.num];
    saveState();
    renderStatuses();
    setStatus(statusFormStatus, `${btn.dataset.num} is back to generated demo data.`, 'ok');
  });

  /* ---------- Reset ---------- */

  $('#reset-data').addEventListener('click', () => {
    if (!window.confirm('Reset all demo data in this browser? Every booking and status override is removed and DEMO01 is restored.')) return;
    state = D.reset();
    closeForm();
    renderAll();
    setStatus(bookingsStatus, '');
    setStatus(statusFormStatus, '');
    setStatus($('#reset-status'), 'Demo data reset. Only DEMO01 remains.', 'ok');
  });

  /* ---------- Start, and follow changes made by the site in another tab ---------- */

  function renderAll() {
    renderBookings();
    renderStatuses();
  }

  window.addEventListener('storage', (e) => {
    if (e.key !== D.KEY) return;
    state = D.load();
    renderAll();
  });

  renderAll();
})();
