const PROPERTIES = [
  { id: "esplanade_4801", label: "Esplanade · 4801 Esplanade", address: "4801 Esplanade", calendar: "ICAL_ESPLANADE_4801", capacity: null },
  { id: "villeneuve_155a", label: "Villeneuve · 155a", address: "155a, rue Villeneuve", calendar: "ICAL_VILLENEUVE_155A", capacity: null },
  { id: "standre_1198", label: "Saint-André · 1198", address: "1198, rue Saint-André", calendar: "ICAL_STANDRE_1198", capacity: null },
  { id: "beaudry_f1597", label: "Beaudry · F1597", address: "1597, rue Beaudry", calendar: "ICAL_BEAUDRY_F1597", capacity: null },
  { id: "villeneuve_155", label: "Villeneuve · 155", address: "155, rue Villeneuve", calendar: "ICAL_VILLENEUVE_155", capacity: null },
  { id: "villeneuve_159", label: "Villeneuve · 159", address: "159, rue Villeneuve", calendar: "ICAL_VILLENEUVE_159", capacity: null },
  { id: "standre_1200", label: "Saint-André · 1200 (Le Boulevard)", address: "1200, rue Saint-André", calendar: "ICAL_STANDRE_1200", capacity: 6, details: "boulevard.html" },
  { id: "lasalle_3881", label: "LaSalle · 3881 (Verdun)", address: "3881, boulevard LaSalle", calendar: "ICAL_LASALLE_3881", capacity: 7, details: "verdun.html" },
];
const ALLOWED_ORIGINS = new Set([
  "https://room-sejours-moyenne-duree.jsdionne.chatgpt.site",
  "http://127.0.0.1:4173",
]);
const cache = new Map();

function response(data, status, origin) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-credentials": "true",
    "vary": "Origin",
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) headers.set("access-control-allow-origin", origin);
  return new Response(status === 204 ? null : JSON.stringify(data), { status, headers });
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
  return time;
}

function dateIn(line) {
  const match = line.match(/:(\d{8})(?:T\d{6}Z?)?$/);
  if (!match) return null;
  const raw = match[1];
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function parseIcal(text) {
  if (!text.includes("BEGIN:VCALENDAR") || !text.includes("END:VCALENDAR")) throw new Error("invalid_calendar");
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const events = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const content = block.split("END:VEVENT")[0];
    const status = (content.match(/^STATUS:(.+)$/m)?.[1] || "").trim().toUpperCase();
    const transparency = (content.match(/^TRANSP:(.+)$/m)?.[1] || "").trim().toUpperCase();
    if (status === "CANCELLED" || transparency === "TRANSPARENT") continue;
    const startLine = content.match(/^DTSTART(?:;[^:]*)?:[^\r\n]+/m)?.[0];
    const endLine = content.match(/^DTEND(?:;[^:]*)?:[^\r\n]+/m)?.[0];
    if (!startLine || !endLine) continue;
    const start = dateIn(startLine);
    const end = dateIn(endLine);
    if (start && end && start < end) events.push({ start, end });
  }
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

async function loadCalendar(property, env) {
  const url = env[property.calendar];
  if (!url) throw new Error("calendar_not_configured");
  const cached = cache.get(property.id);
  if (cached && Date.now() - cached.at < 120000) return cached.events;
  const result = await fetch(url, { headers: { accept: "text/calendar,text/plain;q=0.9,*/*;q=0.1" }, signal: AbortSignal.timeout(10000) });
  if (!result.ok) throw new Error(`calendar_http_${result.status}`);
  const events = parseIcal(await result.text());
  cache.set(property.id, { at: Date.now(), events });
  return events;
}

async function loadAll(env, filterId) {
  const selected = filterId ? PROPERTIES.filter(p => p.id === filterId) : PROPERTIES;
  if (filterId && selected.length === 0) return { rows: [], failed: [] };
  const settled = await Promise.all(selected.map(async property => {
    try { return { property, events: await loadCalendar(property, env), error: null }; }
    catch (error) { return { property, events: [], error: String(error?.message || "calendar_error") }; }
  }));
  return { rows: settled.filter(row => !row.error), failed: settled.filter(row => row.error).map(row => row.property.id) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (request.method === "OPTIONS") return response({}, 204, origin);
    if (request.method !== "GET") return response({ error: "method_not_allowed" }, 405, origin);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return response({ error: "origin_not_allowed" }, 403, origin);

    if (url.pathname === "/health") return response({ ok: true, calendars: PROPERTIES.length }, 200, origin);

    if (url.pathname === "/api/calendars") {
      const propertyId = url.searchParams.get("property");
      const { rows, failed } = await loadAll(env, propertyId);
      const calendars = rows.map(({ property, events }) => ({
        property: { id: property.id, label: property.label, address: property.address, details: property.details || null },
        busy: events,
      }));
      return response({ checkedAt: new Date().toISOString(), calendars, failed, complete: failed.length === 0 }, failed.length && rows.length === 0 ? 503 : 200, origin);
    }

    if (url.pathname === "/api/availability") {
      const arrival = url.searchParams.get("arrival");
      const departure = url.searchParams.get("departure");
      const guests = Number(url.searchParams.get("guests") || 1);
      const start = parseDate(arrival);
      const end = parseDate(departure);
      if (!start || !end || end <= start) return response({ error: "invalid_dates" }, 400, origin);
      const nights = Math.round((end - start) / 86400000);
      if (nights < 31) return response({ error: "minimum_stay_31_nights", minimumNights: 31 }, 400, origin);
      if (!Number.isInteger(guests) || guests < 1 || guests > 20) return response({ error: "invalid_guests" }, 400, origin);
      const { rows, failed } = await loadAll(env);
      const results = rows.filter(({ property, events }) => {
        if (property.capacity && guests > property.capacity) return false;
        return !events.some(event => event.start < departure && event.end > arrival);
      }).map(({ property }) => ({ id: property.id, name: property.label, address: property.address, details: property.details || null, capacity: property.capacity }));
      return response({ arrival, departure, nights, guests, checkedAt: new Date().toISOString(), feedsChecked: rows.length, feedsTotal: PROPERTIES.length, complete: failed.length === 0, failed, results }, 200, origin);
    }

    return response({ error: "not_found" }, 404, origin);
  },
};
