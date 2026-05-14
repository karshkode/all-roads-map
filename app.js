/* ══════════════════════════════════════════════════════════════════
   ALL ROADS LEAD TO THE SOUTH — EVENTS MAP
   Pulls every event tagged "All Roads Lead to the South" from the
   public Mobilize API, plots them on Leaflet, and renders a themed
   side panel that mirrors allroadsleadtothesouth.com.
   ══════════════════════════════════════════════════════════════════ */

const ORG_ID = 5766;
const TAG_ID = 31662;
const PER_PAGE = 100;

const SOUTH_CENTER = [33.5, -88.5];
const INITIAL_ZOOM = 5;

const FLAGSHIP_CITY = 'Montgomery';

const CREATE_EVENT_URL =
  'https://www.mobilize.us/blackvotersmatter/c/all-roads-lead-to-the-south/event/create/?event_creation_source=discovery_page_no_commit';

const HIDDEN_KEY = 'allroads:hidden-events:v1';

const API_URL =
  `https://api.mobilize.us/v1/organizations/${ORG_ID}/events` +
  `?tag_id=${TAG_ID}&per_page=${PER_PAGE}&timeslot_start=gte_now`;

/* ── State ─────────────────────────────────────────────────────── */
const state = {
  events: [],
  markers: new Map(),
  isEditing: false,
  hidden: loadHidden(),
};

/* ── DOM refs ──────────────────────────────────────────────────── */
const els = {
  app: document.getElementById('app'),
  cardList: document.getElementById('card-list'),
  panelMeta: document.getElementById('panel-meta'),
  panelEmpty: document.getElementById('panel-empty'),
  hostCta: document.getElementById('host-cta'),
  editToggle: document.getElementById('edit-toggle'),
  editBanner: document.getElementById('edit-banner'),
  restoreAll: document.getElementById('restore-all'),
  hiddenCount: document.getElementById('hidden-count'),
  detailOverlay: document.getElementById('detail-overlay'),
  detail: document.getElementById('detail'),
  detailBody: document.getElementById('detail-body'),
  detailClose: document.getElementById('detail-close'),
};

/* ══════════════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════════════ */
els.hostCta.href = CREATE_EVENT_URL;

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

els.editToggle.addEventListener('click', toggleEditMode);
els.restoreAll.addEventListener('click', restoreAllHidden);
els.detailClose.addEventListener('click', closeDetail);
els.detailOverlay.addEventListener('click', (e) => {
  if (e.target === els.detailOverlay) closeDetail();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.detailOverlay.hidden) closeDetail();
});

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

  const flagship =
    !!raw.high_priority ||
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
    const isHidden = state.hidden.has(ev.id);
    if (isHidden && !state.isEditing) continue;

    const cls = ['pin'];
    if (ev.flagship) cls.push('is-flagship');
    if (isHidden) cls.push('is-hidden');

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

  const visible = state.events.filter(
    (ev) => state.isEditing || !state.hidden.has(ev.id),
  );

  if (visible.length === 0) {
    els.panelEmpty.hidden = false;
    return;
  }
  els.panelEmpty.hidden = true;

  for (const ev of visible) {
    els.cardList.appendChild(buildCard(ev));
  }
}

function buildCard(ev) {
  const li = document.createElement('li');

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';
  if (ev.flagship) card.classList.add('is-flagship');
  if (state.hidden.has(ev.id)) card.classList.add('is-hidden');
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

  // Hide / Restore action
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const hideBtn = document.createElement('button');
  hideBtn.type = 'button';
  hideBtn.className = 'icon-btn';
  hideBtn.textContent = state.hidden.has(ev.id) ? 'Restore' : 'Hide';
  hideBtn.setAttribute(
    'aria-label',
    `${state.hidden.has(ev.id) ? 'Restore' : 'Hide'} ${ev.title}`,
  );
  hideBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleHidden(ev);
  });
  actions.appendChild(hideBtn);
  card.appendChild(actions);

  li.appendChild(card);
  return li;
}

function renderMeta() {
  const total = state.events.length;
  const hidden = countHiddenInData();
  const visible = total - (state.isEditing ? 0 : hidden);

  if (total === 0) {
    els.panelMeta.textContent = 'No upcoming events yet — check back soon.';
  } else if (state.isEditing) {
    els.panelMeta.textContent = `${total} total · ${hidden} hidden on this device`;
  } else {
    els.panelMeta.textContent = `${visible} event${visible === 1 ? '' : 's'} · May 16, 2026`;
  }

  els.hiddenCount.textContent = hidden
    ? `${hidden} hidden`
    : 'Nothing hidden';
  els.restoreAll.disabled = hidden === 0;
  els.restoreAll.style.opacity = hidden === 0 ? '0.4' : '1';
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
  const visiblePoints = state.events
    .filter((ev) => state.isEditing || !state.hidden.has(ev.id))
    .map((ev) => [ev.lat, ev.lng]);

  if (visiblePoints.length === 0) {
    map.setView(SOUTH_CENTER, INITIAL_ZOOM);
    return;
  }
  if (visiblePoints.length === 1) {
    map.setView(visiblePoints[0], 7);
    return;
  }
  map.fitBounds(visiblePoints, { padding: [40, 40], maxZoom: 7 });
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

  const isHidden = state.hidden.has(ev.id);

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
      <button type="button" class="detail-secondary" id="detail-hide">
        ${isHidden ? 'Restore on my map' : 'Hide from my map'}
      </button>
    </div>
  `;

  els.detailOverlay.hidden = false;
  els.detail.focus();

  document.getElementById('detail-hide').addEventListener('click', () => {
    toggleHidden(ev);
    closeDetail();
  });
}

function closeDetail() {
  els.detailOverlay.hidden = true;
  els.detailBody.innerHTML = '';
}

/* ══════════════════════════════════════════════════════════════════
   HIDE / EDIT
   ══════════════════════════════════════════════════════════════════ */
function toggleHidden(ev) {
  if (state.hidden.has(ev.id)) state.hidden.delete(ev.id);
  else state.hidden.add(ev.id);
  saveHidden();
  renderAll();
}

function restoreAllHidden() {
  if (state.hidden.size === 0) return;
  state.hidden.clear();
  saveHidden();
  renderAll();
}

function toggleEditMode() {
  state.isEditing = !state.isEditing;
  els.editToggle.setAttribute('aria-pressed', String(state.isEditing));
  els.editBanner.hidden = !state.isEditing;
  els.app.classList.toggle('is-editing', state.isEditing);
  renderAll();
}

function loadHidden() {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}
function saveHidden() {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...state.hidden]));
  } catch {
    /* storage may be disabled — fail quietly */
  }
}
function countHiddenInData() {
  let n = 0;
  for (const ev of state.events) if (state.hidden.has(ev.id)) n++;
  return n;
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
    <p>Couldn't reach the Mobilize API.</p>
    <p style="margin-top:8px">
      Check your connection or
      <a href="https://www.mobilize.us/blackvotersmatter/" target="_blank" rel="noopener" style="color:var(--red)">view events directly on Mobilize →</a>
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
