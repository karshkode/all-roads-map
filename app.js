/* ══════════════════════════════════════════════════════════════════
   ALL ROADS LEAD TO THE SOUTH — EVENTS MAP
   Pulls every event tagged "All Roads Lead to the South" from the
   public Mobilize API, plots them on Leaflet, and renders a themed
   side panel that mirrors allroadsleadtothesouth.com.
   ══════════════════════════════════════════════════════════════════ */

const ORG_ID = 5766;
const TAG_ID = 31662;
const PER_PAGE = 100;

/* Mobilize event-creation API.
   ----------------------------
   This site is a public demo with no backend, so we ship with no API key.
   When MOBILIZE_API_KEY is empty the create-event form runs in 'demo
   mode' — it builds the exact payload that would be POSTed to Mobilize
   and shows it to the user instead of sending it. To go live, either:

     1. Drop an organization-level API key (events:write scope) into
        MOBILIZE_API_KEY below — only safe for private deployments since
        anything in this file is publicly viewable.

   …or, the production-shaped option:

     2. Stand up a tiny serverless proxy (Cloudflare Worker, Netlify
        Function, etc.) that holds the key server-side and exposes a
        /create-event endpoint, then point CREATE_EVENT_ENDPOINT at it
        and leave MOBILIZE_API_KEY blank — the proxy adds the auth
        header. */
const MOBILIZE_API_KEY = '';
const CREATE_EVENT_ENDPOINT = `https://api.mobilize.us/v1/organizations/${ORG_ID}/events`;

const SOUTH_CENTER = [33.5, -88.5];
const INITIAL_ZOOM = 5;

const FLAGSHIP_CITY = 'Montgomery';

const DRAFT_KEY = 'allroads:create-draft:v1';

const API_URL =
  `https://api.mobilize.us/v1/organizations/${ORG_ID}/events` +
  `?tag_id=${TAG_ID}&per_page=${PER_PAGE}&timeslot_start=gte_now`;

/* ── State ─────────────────────────────────────────────────────── */
const state = {
  events: [],
  markers: new Map(),
};

/* ── DOM refs ──────────────────────────────────────────────────── */
const els = {
  app: document.getElementById('app'),
  cardList: document.getElementById('card-list'),
  panelMeta: document.getElementById('panel-meta'),
  panelEmpty: document.getElementById('panel-empty'),
  hostCta: document.getElementById('host-cta'),
  detailOverlay: document.getElementById('detail-overlay'),
  detail: document.getElementById('detail'),
  detailBody: document.getElementById('detail-body'),
  detailClose: document.getElementById('detail-close'),
  createOverlay: document.getElementById('create-overlay'),
  createPanel: document.getElementById('create-panel'),
  createClose: document.getElementById('create-close'),
  createCancel: document.getElementById('create-cancel'),
  createForm: document.getElementById('create-form'),
  createError: document.getElementById('create-error'),
  createVirtual: document.getElementById('create-virtual'),
  createSubmit: document.getElementById('create-submit'),
  createSubmitLabel: document.getElementById('create-submit-label'),
  createStepForm: document.getElementById('create-step-form'),
  createStepSuccess: document.getElementById('create-step-success'),
  resultEyebrow: document.getElementById('result-eyebrow'),
  resultTitle: document.getElementById('result-title'),
  resultLede: document.getElementById('result-lede'),
  resultMeta: document.getElementById('result-meta'),
  resultEndpoint: document.getElementById('result-endpoint'),
  resultStatus: document.getElementById('result-status'),
  resultPayloadLabel: document.getElementById('result-payload-label'),
  resultOutput: document.getElementById('result-output'),
  resultBack: document.getElementById('result-back'),
  resultClose: document.getElementById('result-close'),
};

/* ══════════════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════════════ */
const map = L.map('map', {
  zoomControl: true,
  scrollWheelZoom: true,
  worldCopyJump: true,
}).setView(SOUTH_CENTER, INITIAL_ZOOM);

L.tileLayer(
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  },
).addTo(map);

els.hostCta.addEventListener('click', openCreate);
els.detailClose.addEventListener('click', closeDetail);
els.detailOverlay.addEventListener('click', (e) => {
  if (e.target === els.detailOverlay) closeDetail();
});
els.createClose.addEventListener('click', closeCreate);
els.createCancel.addEventListener('click', closeCreate);
els.createOverlay.addEventListener('click', (e) => {
  if (e.target === els.createOverlay) closeCreate();
});
els.createVirtual.addEventListener('change', syncVirtualState);
els.createForm.addEventListener('submit', handleCreateSubmit);
els.createForm.addEventListener('input', persistDraftSoon);
els.resultBack.addEventListener('click', showFormStep);
els.resultClose.addEventListener('click', closeCreate);
els.resultOutput.addEventListener('focus', () => els.resultOutput.select());
els.resultOutput.addEventListener('click', () => els.resultOutput.select());

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!els.createOverlay.hidden) closeCreate();
  else if (!els.detailOverlay.hidden) closeDetail();
});

restoreDraft();
els.createSubmitLabel.textContent = MOBILIZE_API_KEY
  ? 'Submit to Mobilize'
  : 'Preview API call';

renderSkeletons();
loadEvents().catch(handleLoadError);

/* ══════════════════════════════════════════════════════════════════
   DATA
   ══════════════════════════════════════════════════════════════════ */
async function loadEvents() {
  const all = [];
  let url = API_URL;
  // Defensive: cap pagination so a misbehaving API can't loop forever.
  for (let page = 0; page < 10 && url; page++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Mobilize API ${res.status}`);
    const json = await res.json();
    if (Array.isArray(json.data)) all.push(...json.data);
    url = json.next || null;
  }

  state.events = all.map(normalize).filter((e) => e.lat != null && e.lng != null);
  state.events.sort(sortEvents);

  renderAll();
}

function normalize(raw) {
  const loc = raw.location || {};
  const addr = loc.address_lines || [];
  const city = loc.locality || '';
  const region = loc.region || '';
  const venue = loc.venue || '';
  const lat = loc.location?.latitude ?? null;
  const lng = loc.location?.longitude ?? null;

  const ts = Array.isArray(raw.timeslots) ? [...raw.timeslots] : [];
  ts.sort((a, b) => (a.start_date || 0) - (b.start_date || 0));
  const next = ts[0] || null;

  // Flagship status is location-based, not derived from Mobilize's
  // high_priority flag — the vetting team marks lots of events as
  // high-priority to help them surface, but only the Montgomery rally
  // is the flagship of the National Day of Action.
  const flagship =
    /montgomery/i.test(city) ||
    (raw.title || '').toLowerCase().includes(FLAGSHIP_CITY.toLowerCase());

  return {
    id: raw.id,
    title: raw.title || 'Untitled event',
    description: raw.description || '',
    summary: raw.summary || '',
    image: raw.featured_image_url || '',
    browserUrl: raw.browser_url || '',
    accessibility: raw.accessibility_status || '',
    notes: raw.accessibility_notes || '',
    eventType: raw.event_type || '',
    isVirtual: !!raw.is_virtual,
    city,
    region,
    venue,
    addressLines: addr,
    lat,
    lng,
    timeslot: next,
    timeslots: ts,
    flagship,
  };
}

function sortEvents(a, b) {
  if (a.flagship && !b.flagship) return -1;
  if (!a.flagship && b.flagship) return 1;
  const ta = a.timeslot?.start_date ?? Infinity;
  const tb = b.timeslot?.start_date ?? Infinity;
  if (ta !== tb) return ta - tb;
  return a.title.localeCompare(b.title);
}

/* ══════════════════════════════════════════════════════════════════
   RENDER
   ══════════════════════════════════════════════════════════════════ */
function renderAll() {
  renderMarkers();
  renderCards();
  renderMeta();
  fitMapToVisible();
}

function renderMarkers() {
  for (const m of state.markers.values()) m.remove();
  state.markers.clear();

  for (const ev of state.events) {
    const cls = ['pin'];
    if (ev.flagship) cls.push('is-flagship');

    const icon = L.divIcon({
      className: '',
      html: `<div class="${cls.join(' ')}" aria-hidden="true"></div>`,
      iconSize: ev.flagship ? [28, 28] : [22, 22],
      iconAnchor: ev.flagship ? [14, 14] : [11, 11],
      popupAnchor: [0, -14],
    });

    const marker = L.marker([ev.lat, ev.lng], { icon, title: ev.title })
      .addTo(map)
      .bindPopup(popupHtml(ev), { closeButton: true, autoPan: true });
    marker.on('click', () => openDetail(ev));
    state.markers.set(ev.id, marker);
  }
}

function popupHtml(ev) {
  const where = [ev.city, ev.region].filter(Boolean).join(', ');
  return `
    <strong>${escapeHtml(ev.title)}</strong>
    ${where ? `<span class="pop-meta">${escapeHtml(where)}</span>` : ''}
    ${ev.timeslot ? `<span class="pop-meta">${escapeHtml(formatWhen(ev.timeslot))}</span>` : ''}
  `;
}

function renderCards() {
  els.cardList.removeAttribute('aria-busy');
  els.cardList.innerHTML = '';

  if (state.events.length === 0) {
    els.panelEmpty.hidden = false;
    return;
  }
  els.panelEmpty.hidden = true;

  for (const ev of state.events) {
    els.cardList.appendChild(buildCard(ev));
  }
}

function buildCard(ev) {
  const li = document.createElement('li');

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';
  if (ev.flagship) card.classList.add('is-flagship');
  card.addEventListener('click', () => openDetail(ev));
  card.addEventListener('mouseenter', () => focusMarker(ev));

  const thumb = document.createElement('div');
  thumb.className = 'card-thumb';
  if (ev.image) {
    thumb.style.backgroundImage = `url("${encodeURI(ev.image)}")`;
  } else {
    const fb = document.createElement('span');
    fb.className = 'card-thumb-fallback';
    fb.textContent = (ev.city || ev.title || 'A')[0].toUpperCase();
    thumb.appendChild(fb);
  }

  const body = document.createElement('div');
  body.className = 'card-body';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'card-eyebrow';
  if (ev.flagship) {
    eyebrow.textContent = 'Flagship · Montgomery';
  } else {
    eyebrow.classList.add('is-quiet');
    eyebrow.textContent = [ev.city, ev.region].filter(Boolean).join(', ') || 'Satellite event';
  }

  const title = document.createElement('h3');
  title.className = 'card-title';
  title.textContent = ev.title;

  const meta = document.createElement('p');
  meta.className = 'card-meta';
  const bits = [];
  if (ev.timeslot) bits.push(formatWhen(ev.timeslot));
  if (ev.venue) bits.push(ev.venue);
  if (!bits.length && ev.isVirtual) bits.push('Virtual');
  meta.textContent = bits.join(' · ');

  body.append(eyebrow, title, meta);
  card.append(thumb, body);

  li.appendChild(card);
  return li;
}

function renderMeta() {
  const total = state.events.length;
  if (total === 0) {
    els.panelMeta.textContent = 'No upcoming events yet — check back soon.';
  } else {
    els.panelMeta.textContent = `${total} event${total === 1 ? '' : 's'} · May 16, 2026`;
  }
}

function renderSkeletons() {
  els.cardList.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="card" aria-hidden="true" style="cursor:default">
        <div class="card-thumb skel"></div>
        <div class="card-body">
          <div class="skel" style="height:9px;width:40%;margin-bottom:10px"></div>
          <div class="skel" style="height:14px;width:80%;margin-bottom:8px"></div>
          <div class="skel" style="height:10px;width:60%"></div>
        </div>
      </div>`;
    els.cardList.appendChild(li);
  }
}

function fitMapToVisible() {
  const points = state.events.map((ev) => [ev.lat, ev.lng]);
  if (points.length === 0) {
    map.setView(SOUTH_CENTER, INITIAL_ZOOM);
    return;
  }
  if (points.length === 1) {
    map.setView(points[0], 7);
    return;
  }
  map.fitBounds(points, { padding: [40, 40], maxZoom: 7 });
}

function focusMarker(ev) {
  const m = state.markers.get(ev.id);
  if (!m) return;
  m.openPopup();
}

/* ══════════════════════════════════════════════════════════════════
   DETAIL VIEW
   ══════════════════════════════════════════════════════════════════ */
function openDetail(ev) {
  const where = [ev.city, ev.region].filter(Boolean).join(', ');
  const address = ev.addressLines.filter(Boolean).join(', ');

  const heroBg = ev.image
    ? `style="background-image:url('${encodeURI(ev.image)}')"`
    : '';
  const heroFallback = ev.image
    ? ''
    : `<span class="detail-hero-fallback">${escapeHtml(
        (ev.city || ev.title || 'A')[0].toUpperCase(),
      )}</span>`;

  const facts = [
    ['When', ev.timeslot ? formatWhenLong(ev.timeslot) : 'TBA'],
    ['Where', [ev.venue, where, address].filter(Boolean).join(' · ') || (ev.isVirtual ? 'Virtual' : 'TBA')],
    ['Type', humanType(ev.eventType, ev.isVirtual)],
    ['Access', humanAccess(ev.accessibility, ev.notes)],
  ];

  const factsHtml = facts
    .filter(([, v]) => v)
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
    .join('');

  const desc = (ev.description || ev.summary || '').trim();
  const descHtml = desc
    ? desc
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
        .join('')
    : '<p>Details on Mobilize.</p>';

  els.detailBody.innerHTML = `
    <div class="detail-hero" ${heroBg}>${heroFallback}</div>
    <div class="detail-content">
      <p class="detail-eyebrow">${ev.flagship ? 'Flagship Rally' : 'Satellite Event'}</p>
      <h2 id="detail-title">${escapeHtml(ev.title)}</h2>
      <dl class="detail-facts">${factsHtml}</dl>
      <div class="detail-desc">${descHtml}</div>
      ${
        ev.browserUrl
          ? `<a class="detail-cta" href="${encodeURI(ev.browserUrl)}" target="_blank" rel="noopener">
              RSVP on Mobilize
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 6h8M6 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>
              </svg>
            </a>`
          : ''
      }
    </div>
  `;

  els.detailOverlay.hidden = false;
  els.detail.focus();
}

function closeDetail() {
  els.detailOverlay.hidden = true;
  els.detailBody.innerHTML = '';
}

/* ══════════════════════════════════════════════════════════════════
   CREATE-EVENT FORM
   In-page form modeled on the public Mobilize event-creation form.
   On submit we build the Mobilize-shaped JSON payload and either
   POST it to /v1/organizations/{org}/events (when MOBILIZE_API_KEY
   is set) or render it as a stubbed payload preview (demo mode).
   ══════════════════════════════════════════════════════════════════ */
function openCreate() {
  els.createOverlay.hidden = false;
  showFormStep();
  syncVirtualState();
  hideCreateError();
  // Defer focus so the slide-in animation can paint first.
  requestAnimationFrame(() => {
    els.createPanel.focus({ preventScroll: false });
    const firstInvalid = els.createForm.querySelector(
      'input:not([value]), input[value=""], textarea:empty',
    );
    const firstField = firstInvalid || els.createForm.querySelector('input, select, textarea');
    if (firstField) firstField.focus({ preventScroll: true });
  });
}

function closeCreate() {
  els.createOverlay.hidden = true;
  hideCreateError();
  // Reset to form step so the next open starts fresh from the top.
  showFormStep();
}

function showFormStep() {
  els.createStepForm.hidden = false;
  els.createStepSuccess.hidden = true;
}

function showResultStep() {
  els.createStepForm.hidden = true;
  els.createStepSuccess.hidden = false;
  // Scroll the side-sheet back to the top so the user sees the result.
  if (typeof els.createPanel.scrollTo === 'function') {
    els.createPanel.scrollTo({ top: 0, behavior: 'auto' });
  } else {
    els.createPanel.scrollTop = 0;
  }
}

function syncVirtualState() {
  els.createForm.classList.toggle('is-virtual', els.createVirtual.checked);
  // Toggle 'required' on physical-location fields so virtual events validate.
  for (const el of els.createForm.querySelectorAll('[data-physical] [required]')) {
    el.dataset.required = el.dataset.required || 'true';
  }
  for (const el of els.createForm.querySelectorAll('[data-physical] input, [data-physical] select')) {
    if (el.dataset.required === 'true') {
      el.required = !els.createVirtual.checked;
    }
  }
}

function handleCreateSubmit(e) {
  e.preventDefault();
  hideCreateError();
  els.createForm.classList.add('was-submitted');

  const data = readForm();
  const errors = validateCreate(data);
  if (errors.length) {
    showCreateError(errors[0]);
    const firstBad = els.createForm.querySelector(`[name="${cssEscape(errors[0].field)}"]`);
    if (firstBad) firstBad.focus({ preventScroll: false });
    return;
  }

  const payload = buildMobilizePayload(data);

  // Demo mode: no API key, just show the payload. Keeps this file safe
  // to ship publicly while still exercising the full validation +
  // payload-building code path that the live submit will use.
  if (!MOBILIZE_API_KEY) {
    renderResult({
      kind: 'demo',
      eyebrow: 'Demo mode',
      title: 'Stubbed submission',
      lede:
        'No MOBILIZE_API_KEY configured. Below is the JSON payload this form would POST to ' +
        `${CREATE_EVENT_ENDPOINT} with an "Authorization: Bearer <key>" header.`,
      endpoint: `POST ${CREATE_EVENT_ENDPOINT}`,
      status: 'Not sent (demo)',
      payloadLabel: 'Request payload (stub)',
      body: JSON.stringify(payload, null, 2),
    });
    return;
  }

  // Live mode: POST to Mobilize. Disable the submit button so it can't
  // be clicked twice while the request is in flight.
  els.createSubmit.disabled = true;
  const prevLabel = els.createSubmitLabel.textContent;
  els.createSubmitLabel.textContent = 'Submitting…';

  submitToMobilize(payload)
    .then((result) => {
      renderResult({
        kind: 'success',
        eyebrow: 'Submitted',
        title: 'Event sent to Mobilize',
        lede:
          'Mobilize accepted the submission. The event will appear on the map ' +
          'after their team approves it.',
        endpoint: `POST ${CREATE_EVENT_ENDPOINT}`,
        status: `${result.status} ${result.statusText}`.trim(),
        payloadLabel: 'API response',
        body: result.bodyText,
      });
      // Clear the saved draft on a successful submit.
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    })
    .catch((err) => {
      renderResult({
        kind: 'error',
        eyebrow: 'Submission failed',
        title: 'Couldn\u2019t reach Mobilize',
        lede:
          'The request to /v1/events did not succeed. The full response is ' +
          'below — your draft is still saved so you can edit and retry.',
        endpoint: `POST ${CREATE_EVENT_ENDPOINT}`,
        status: err.status ? `${err.status} ${err.statusText || ''}`.trim() : 'Network error',
        payloadLabel: 'Error detail',
        body: err.bodyText || String(err.message || err),
      });
    })
    .finally(() => {
      els.createSubmit.disabled = false;
      els.createSubmitLabel.textContent = prevLabel;
    });
}

/* POST the payload to Mobilize. Resolves with { status, statusText, bodyText }
   on 2xx and rejects with the same shape (plus a .message) on non-2xx or
   network failure, so the result UI can render the actual server response. */
async function submitToMobilize(payload) {
  let res;
  try {
    res = await fetch(CREATE_EVENT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${MOBILIZE_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (networkErr) {
    const e = new Error(networkErr.message || 'Network error');
    e.bodyText = String(networkErr.message || networkErr);
    throw e;
  }

  const bodyText = await res.text();
  // Pretty-print JSON responses; leave HTML/plain text alone.
  let pretty = bodyText;
  try { pretty = JSON.stringify(JSON.parse(bodyText), null, 2); } catch { /* not json */ }

  if (!res.ok) {
    const e = new Error(`Mobilize API ${res.status}`);
    e.status = res.status;
    e.statusText = res.statusText;
    e.bodyText = pretty;
    throw e;
  }
  return { status: res.status, statusText: res.statusText, bodyText: pretty };
}

/* Translate the form's flat input shape into Mobilize's event creation
   schema. Keep this function pure so it's easy to unit-test and so the
   demo-mode preview matches what a real submission would send. */
function buildMobilizePayload(d) {
  const startTs = parseLocalUnix(d.date, d.startTime, d.timezone);
  const endTs = parseLocalUnix(d.date, d.endTime, d.timezone);

  const payload = {
    title: d.title,
    description: d.description,
    event_type: d.eventType,
    is_virtual: !!d.isVirtual,
    timeslots: [{ start_date: startTs, end_date: endTs }],
    tag_ids: [TAG_ID],
    contact: {
      name: d.hostName,
      email_address: d.hostEmail,
    },
  };

  if (d.image) payload.featured_image_url = d.image;
  if (d.hostPhone) payload.contact.phone_number = d.hostPhone;
  if (d.hostOrg) payload.contact.owner_user_organization = d.hostOrg;

  if (!d.isVirtual) {
    payload.location = {
      venue: d.venue || '',
      address_lines: d.address ? [d.address] : [],
      locality: d.city,
      region: d.region,
      postal_code: d.postal || '',
    };
  }

  if (d.accessibility) payload.accessibility_status = d.accessibility;
  if (d.accessibilityNotes) payload.accessibility_notes = d.accessibilityNotes;

  return payload;
}

/* Convert a (date, time, IANA tz) tuple into a unix timestamp.
   Strategy:
     1. Pretend the local components are UTC -> utcGuess.
     2. Render utcGuess in the target zone and re-pack those components
        as UTC -> renderedUtc.
     3. The difference (utcGuess - renderedUtc) is exactly the zone's
        offset at that moment; nudge ts by it.
     4. Iterate once more to absorb any DST step that crossed the nudge. */
function parseLocalUnix(date, time, tz) {
  if (!date || !time) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const utcGuess = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  if (!tz) return Math.floor(utcGuess / 1000);

  let ts = utcGuess;
  for (let i = 0; i < 2; i++) {
    const renderedUtc = asUtcEquivalent(ts, tz);
    const delta = utcGuess - renderedUtc;
    if (delta === 0) break;
    ts += delta;
  }
  return Math.floor(ts / 1000);
}

function asUtcEquivalent(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ts));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  // Intl returns hour 24 at midnight in some locales; normalize to 0.
  const hour = get('hour') === 24 ? 0 : get('hour');
  return Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
}

function renderResult({ kind, eyebrow, title, lede, endpoint, status, payloadLabel, body }) {
  els.resultEyebrow.textContent = eyebrow;
  els.resultTitle.textContent = title;
  els.resultLede.textContent = lede;
  els.resultEndpoint.innerHTML = `<code>${escapeHtml(endpoint)}</code>`;
  els.resultStatus.textContent = status;
  els.resultMeta.hidden = false;
  els.resultPayloadLabel.textContent = payloadLabel;
  els.resultOutput.value = body;
  els.resultOutput.dataset.kind = kind;
  showResultStep();
}

function readForm() {
  const fd = new FormData(els.createForm);
  const obj = {};
  for (const [k, v] of fd.entries()) obj[k] = typeof v === 'string' ? v.trim() : v;
  obj.isVirtual = els.createVirtual.checked;
  return obj;
}

function validateCreate(d) {
  const errs = [];
  const need = (field, label) => {
    if (!d[field]) errs.push({ field, message: `${label} is required.` });
  };
  need('title', 'Event name');
  need('eventType', 'Event type');
  need('description', 'Description');
  need('date', 'Date');
  need('startTime', 'Start time');
  need('endTime', 'End time');
  need('hostName', 'Host name');
  need('hostEmail', 'Host email');
  if (d.hostEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.hostEmail)) {
    errs.push({ field: 'hostEmail', message: 'Host email looks invalid.' });
  }
  if (!d.isVirtual) {
    need('city', 'City');
    need('region', 'State');
  }
  if (d.startTime && d.endTime && d.endTime <= d.startTime) {
    errs.push({ field: 'endTime', message: 'End time must be after start time.' });
  }
  return errs;
}

function showCreateError(err) {
  els.createError.textContent = err.message || String(err);
  els.createError.hidden = false;
}
function hideCreateError() {
  els.createError.hidden = true;
  els.createError.textContent = '';
}

/* ── Draft persistence ─────────────────────────────────────────── */
let draftTimer = null;
function persistDraftSoon() {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraft, 250);
}
function persistDraft() {
  try {
    const data = readForm();
    // Don't persist if every field is empty — keeps storage clean.
    const hasAny = Object.values(data).some((v) => v && v !== false);
    if (hasAny) localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage may be disabled — fail quietly */
  }
}
function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    for (const [name, value] of Object.entries(data || {})) {
      const field = els.createForm.elements.namedItem(name);
      if (!field) continue;
      if (field.type === 'checkbox') field.checked = !!value;
      else field.value = value ?? '';
    }
    syncVirtualState();
  } catch {
    /* ignore corrupt drafts */
  }
}

function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

/* ══════════════════════════════════════════════════════════════════
   ERRORS
   ══════════════════════════════════════════════════════════════════ */
function handleLoadError(err) {
  console.error('Failed to load events:', err);
  els.cardList.innerHTML = '';
  els.cardList.removeAttribute('aria-busy');
  els.panelEmpty.hidden = false;
  els.panelEmpty.innerHTML = `
    <p>Couldn&rsquo;t reach the Mobilize API.</p>
    <p style="margin-top:8px">
      Check your connection or
      <a href="https://www.mobilize.us/blackvotersmatter/" target="_blank" rel="noopener" style="color:var(--red)">view events directly on Mobilize &rarr;</a>
    </p>`;
  els.panelMeta.textContent = 'Connection error';
}

/* ══════════════════════════════════════════════════════════════════
   UTILS
   ══════════════════════════════════════════════════════════════════ */
function formatWhen(ts) {
  const start = new Date((ts.start_date || 0) * 1000);
  return start.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function formatWhenLong(ts) {
  const start = new Date((ts.start_date || 0) * 1000);
  const end = ts.end_date ? new Date(ts.end_date * 1000) : null;
  const dateStr = start.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const startTime = start.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const endTime = end
    ? end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null;
  return endTime ? `${dateStr} · ${startTime} – ${endTime}` : `${dateStr} · ${startTime}`;
}

function humanType(t, virtual) {
  if (virtual) return 'Virtual';
  if (!t) return '';
  return t
    .toLowerCase()
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function humanAccess(status, notes) {
  const s = (status || '').toUpperCase();
  if (s === 'ACCESSIBLE') return notes ? `Accessible · ${notes}` : 'Accessible';
  if (s === 'NOT_ACCESSIBLE')
    return notes ? `Not fully accessible · ${notes}` : 'Not fully accessible';
  if (notes) return notes;
  return '';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}
