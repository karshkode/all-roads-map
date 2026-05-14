# All Roads Lead to the South — Events Map

A static, themed map of the **National Day of Action for Voting Rights — May 16, 2026**
rallies, themed to match [allroadsleadtothesouth.com](https://allroadsleadtothesouth.com)
and pulling live from the public Mobilize events API.

No build step. No API keys. Three files: `index.html`, `styles.css`, `app.js`.

---

## What it does

- Fetches every event tagged **"All Roads Lead to the South"** (tag_id `31662`)
  from Black Voters Matter on Mobilize (org_id `5766`).
- Plots them on a Leaflet map (CARTO dark tiles, OpenStreetMap data) centered
  on the South.
- Renders a side panel of detail cards with hero image, city, time, venue, and
  accessibility status.
- Clicking a marker or a card opens a full detail view with the event
  description and an **RSVP on Mobilize →** CTA that deep-links to the event's
  Mobilize page (e.g. `https://www.mobilize.us/blackvotersmatter/event/954820/`).
- The flagship Montgomery, AL rally (`high_priority: true`) gets a red pulsing
  pin and is pinned to the top of the list.
- **Host an event →** button deep-links to the official Mobilize create form
  for the All Roads campaign (the same URL used by allroadsleadtothesouth.com).
- **Hide** any event from your local view; toggle **Edit mode** to manage your
  hidden list and restore events. Hidden state lives in `localStorage` only —
  it never touches the upstream Mobilize record (which requires authentication
  to mutate).

---

## Run locally

The page must be served over `http(s)://` (not `file://`) so that browser
`fetch()` to the Mobilize API works cleanly.

```powershell
cd "C:\Users\karsh\OneDrive\Documents\Developer\all-roads-map"
python -m http.server 8000
# then open http://localhost:8000
```

Or with Node.js:

```powershell
npx serve .
```

Or VS Code's "Live Server" extension — right-click `index.html` →
**Open with Live Server**.

---

## Deploy

It's a static site — anywhere will work.

### Netlify

1. `netlify deploy --dir . --prod`, or
2. Drag-and-drop the project folder onto <https://app.netlify.com/drop>.

### Firebase Hosting

```powershell
firebase init hosting
# Public directory: .
# Single-page app: No
firebase deploy --only hosting
```

### GitHub Pages

Push to a repo, then in **Settings → Pages** point at the `main` branch root.

---

## Data source

Single, unauthenticated, CORS-open request:

```
GET https://api.mobilize.us/v1/organizations/5766/events?tag_id=31662&per_page=100&timeslot_start=gte_now
```

The response shape and full field list are documented at
<https://github.com/mobilizeamerica/api>.

If the tag ID changes for a future Day of Action, update the `TAG_ID` constant
in [`app.js`](./app.js).

---

## Customization quick reference

All theme tokens are CSS custom properties at the top of
[`styles.css`](./styles.css), and they mirror the live
allroadsleadtothesouth.com stylesheet exactly:

| Variable      | Purpose                            | Default     |
| ------------- | ---------------------------------- | ----------- |
| `--ink`       | page background                    | `#1A1714`   |
| `--bone`      | text on dark / panel background    | `#F4EFE6`   |
| `--red`       | primary action / standard markers  | `#C83828`   |
| `--ink-70`    | secondary text on bone             | `rgba(26,23,20,0.70)` |
| `--bone-50`   | secondary text on ink              | `rgba(244,239,230,0.50)` |
| `--f-display` | display font (headlines, body)     | Archivo     |
| `--f-mono`    | meta / eyebrow text                | JetBrains Mono |
| `--ease`      | shared ease curve                  | `cubic-bezier(0.16, 1, 0.3, 1)` |

Map view defaults live at the top of [`app.js`](./app.js):

```js
const SOUTH_CENTER = [33.5, -88.5];
const INITIAL_ZOOM = 5;
```

The Mobilize create-event deep-link (used by **Host an event →**) lives in
the same constants block so you can repoint it for a future campaign:

```js
const CREATE_EVENT_URL =
  'https://www.mobilize.us/blackvotersmatter/c/all-roads-lead-to-the-south/event/create/?event_creation_source=discovery_page_no_commit';
```

---

## Credits

- Event data: [Black Voters Matter on Mobilize](https://www.mobilize.us/blackvotersmatter/)
- Day of Action: [allroadsleadtothesouth.com](https://allroadsleadtothesouth.com)
  · [blackpowerwarroom.com/dayofaction](https://blackpowerwarroom.com/dayofaction/)
- Map tiles: [CARTO](https://carto.com/attributions) +
  [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- Map library: [Leaflet 1.9.4](https://leafletjs.com/)
