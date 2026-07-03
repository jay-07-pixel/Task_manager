const cache = new Map();
const USER_AGENT = "KalpanikTaskManager/1.0 (attendance; contact@kalpanik.in)";

function getGoogleMapsApiKey() {
  return (process.env.GOOGLE_MAPS_API_KEY || "").trim();
}

export function isGoogleMapsConfigured() {
  return !!getGoogleMapsApiKey();
}

export function getGoogleMapsBrowserKey() {
  return getGoogleMapsApiKey() || null;
}

function cacheKey(lat, lng) {
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
}

function samePlace(a, b) {
  if (!a || !b) return false;
  return a.toLowerCase().trim() === b.toLowerCase().trim();
}

function componentByTypes(components, types) {
  for (const type of types) {
    const hit = components.find((c) => Array.isArray(c.types) && c.types.includes(type));
    if (hit?.long_name?.trim()) return hit.long_name.trim();
  }
  return null;
}

/**
 * Prefer neighbourhood / colony / area, then city.
 * e.g. "Ravi Nagar, Kopargaon"
 */
export function formatGooglePlaceDetails(result) {
  const components = result?.address_components;
  if (!Array.isArray(components) || !components.length) {
    return { area: null, city: null, placeName: null };
  }

  const area = componentByTypes(components, [
    "neighborhood",
    "sublocality_level_2",
    "sublocality_level_1",
    "sublocality",
    "premise",
    "route",
    "point_of_interest",
    "establishment",
  ]);

  let city = componentByTypes(components, [
    "locality",
    "postal_town",
    "administrative_area_level_3",
    "administrative_area_level_2",
  ]);

  if (samePlace(area, city)) {
    city = componentByTypes(components, [
      "administrative_area_level_2",
      "administrative_area_level_1",
    ]);
    if (samePlace(area, city)) city = null;
  }

  if (area && city) {
    return { area, city, placeName: `${area}, ${city}` };
  }
  if (area) {
    return { area, city: null, placeName: area };
  }
  if (city) {
    // Try to pull a finer part from formatted_address (first segment before city)
    const formatted = result.formatted_address || "";
    const parts = formatted
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p && !/^\d{5,7}$/.test(p) && !/^india$/i.test(p));
    const finer = parts.find((p) => !samePlace(p, city));
    if (finer) {
      return { area: finer, city, placeName: `${finer}, ${city}` };
    }
    return { area: null, city, placeName: city };
  }

  const formatted = result.formatted_address;
  if (typeof formatted === "string" && formatted.trim()) {
    const parts = formatted
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p && !/^\d{5,7}$/.test(p) && !/^india$/i.test(p));
    if (parts.length >= 2) {
      return { area: parts[0], city: parts[1], placeName: `${parts[0]}, ${parts[1]}` };
    }
    if (parts[0]) return { area: parts[0], city: null, placeName: parts[0] };
  }

  return { area: null, city: null, placeName: null };
}

function pickBestGoogleResult(results) {
  if (!Array.isArray(results) || !results.length) return null;
  const preferred = results.find((r) =>
    (r.types || []).some((t) =>
      ["street_address", "premise", "subpremise", "route", "neighborhood", "sublocality", "sublocality_level_1"].includes(t)
    )
  );
  return preferred || results[0];
}

async function reverseGeocodeGoogle(latitude, longitude) {
  const key = getGoogleMapsApiKey();
  if (!key) return null;

  const params = new URLSearchParams({
    latlng: `${latitude},${longitude}`,
    key,
    language: "en",
    result_type: "street_address|premise|subpremise|route|neighborhood|sublocality|sublocality_level_1|locality",
  });

  let res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
  let data = await res.json();

  // Broader query if result_type filter returns nothing
  if (data.status === "ZERO_RESULTS" || !data.results?.length) {
    const fallbackParams = new URLSearchParams({
      latlng: `${latitude},${longitude}`,
      key,
      language: "en",
    });
    res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${fallbackParams}`);
    data = await res.json();
  }

  if (data.status !== "OK" || !data.results?.length) {
    if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.warn("[geocode] Google status=", data.status, data.error_message || "");
    }
    return null;
  }

  return formatGooglePlaceDetails(pickBestGoogleResult(data.results));
}

function formatNominatimPlaceDetails(data) {
  const a = data?.address;
  if (!a) return { area: null, city: null, placeName: null };

  const area =
    a.neighbourhood ||
    a.suburb ||
    a.city_district ||
    a.quarter ||
    a.residential ||
    a.road ||
    a.village ||
    null;

  let city = a.city || a.town || a.municipality || a.county || null;
  if (samePlace(area, city)) {
    city = a.state_district || a.state || null;
    if (samePlace(area, city)) city = null;
  }

  if (area && city) return { area, city, placeName: `${area}, ${city}` };
  if (area) return { area, city: null, placeName: area };
  if (city) return { area: null, city, placeName: city };
  return { area: null, city: null, placeName: null };
}

async function reverseGeocodeNominatim(latitude, longitude) {
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
  if (!res.ok) return null;
  const data = await res.json();
  return formatNominatimPlaceDetails(data);
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
    let details = await reverseGeocodeGoogle(latitude, longitude);
    if (!details?.placeName) {
      details = await reverseGeocodeNominatim(latitude, longitude);
    }
    cache.set(key, details);
    return details;
  } catch (err) {
    console.warn("[geocode] failed", err?.message || err);
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

  const delayMs = isGoogleMapsConfigured() ? 50 : 250;
  for (const [key, ids] of pending) {
    const [lat, lng] = key.split(",").map(Number);
    const details = await reverseGeocodeDetails(lat, lng);
    for (const id of ids) {
      out.set(id, details?.placeName ?? null);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }

  return out;
}
