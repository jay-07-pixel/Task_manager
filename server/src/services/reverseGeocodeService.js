const cache = new Map();
const USER_AGENT = "KalpanikTaskManager/1.0 (attendance; contact@kalpanik.in)";

function cacheKey(lat, lng) {
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
}

function cleanPart(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function pickFirst(address, keys) {
  for (const key of keys) {
    const part = cleanPart(address[key]);
    if (part) return part;
  }
  return null;
}

function samePlace(a, b) {
  if (!a || !b) return false;
  return a.toLowerCase().trim() === b.toLowerCase().trim();
}

function formatFromDisplayName(display) {
  if (typeof display !== "string" || !display.trim()) return null;
  const parts = display
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !/^\d{5,7}$/.test(p) && !/^india$/i.test(p));

  if (parts.length >= 2) {
    const area = parts[0];
    const city = parts.find((p, i) => i > 0 && !samePlace(p, area)) ?? parts[1];
    if (area && city) return `${area}, ${city}`;
  }
  return parts.slice(0, 2).join(", ") || null;
}

/**
 * Build area + city from Nominatim address parts.
 * @returns {{ area: string | null, city: string | null, placeName: string | null }}
 */
export function formatPlaceDetails(data) {
  const a = data?.address;
  if (!a) {
    const fallback = formatFromDisplayName(data?.display_name);
    if (!fallback) return { area: null, city: null, placeName: null };
    const [area, city] = fallback.split(",").map((s) => s.trim());
    return { area: area || null, city: city || null, placeName: fallback };
  }

  const area = pickFirst(a, [
    "neighbourhood",
    "suburb",
    "city_district",
    "quarter",
    "borough",
    "hamlet",
    "village",
    "residential",
    "industrial",
    "road",
    "pedestrian",
    "footway",
  ]);

  let city = pickFirst(a, ["city", "town", "municipality", "county", "state_district"]);

  if (samePlace(area, city)) {
    city = pickFirst(a, ["city", "county", "state_district", "state"]);
    if (samePlace(area, city)) city = null;
  }

  if (!area && city) {
    const finer = pickFirst(a, ["neighbourhood", "suburb", "city_district", "road"]);
    if (finer && !samePlace(finer, city)) {
      return { area: finer, city, placeName: `${finer}, ${city}` };
    }
    return { area: null, city, placeName: city };
  }

  if (area && !city) {
    city = pickFirst(a, ["state_district", "state", "county"]);
    if (city && !samePlace(area, city)) {
      return { area, city, placeName: `${area}, ${city}` };
    }
    return { area, city: null, placeName: area };
  }

  if (area && city) {
    return { area, city, placeName: `${area}, ${city}` };
  }

  const fallback = formatFromDisplayName(data?.display_name);
  if (!fallback) return { area: null, city: null, placeName: null };
  const [fa, fc] = fallback.split(",").map((s) => s.trim());
  return { area: fa || null, city: fc || null, placeName: fallback };
}

/** @deprecated use formatPlaceDetails — kept for single-string callers */
export function formatPlaceName(data) {
  return formatPlaceDetails(data).placeName;
}

export async function reverseGeocode(latitude, longitude) {
  const details = await reverseGeocodeDetails(latitude, longitude);
  return details?.placeName ?? null;
}

export async function reverseGeocodeDetails(latitude, longitude) {
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    Number.isNaN(latitude) ||
    Number.isNaN(longitude)
  ) {
    return null;
  }
  const key = cacheKey(latitude, longitude);
  if (cache.has(key)) return cache.get(key);

  try {
    const params = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      format: "json",
      zoom: "18",
      addressdetails: "1",
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }
    const data = await res.json();
    const details = formatPlaceDetails(data);
    cache.set(key, details);
    return details;
  } catch {
    cache.set(key, null);
    return null;
  }
}

export async function reverseGeocodeMany(coords) {
  const out = new Map();
  const pending = new Map();

  for (const { id, latitude, longitude } of coords) {
    const key = cacheKey(latitude, longitude);
    if (cache.has(key)) {
      const cached = cache.get(key);
      out.set(id, cached?.placeName ?? null);
      continue;
    }
    if (pending.has(key)) {
      pending.get(key).push(id);
      continue;
    }
    pending.set(key, [id]);
  }

  for (const [key, ids] of pending) {
    const [lat, lng] = key.split(",").map(Number);
    const details = await reverseGeocodeDetails(lat, lng);
    for (const id of ids) {
      out.set(id, details?.placeName ?? null);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return out;
}
