const EARTH_RADIUS_M = 6_371_000;

/** Haversine distance in meters between two WGS84 points. */
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function validateCoordinates(latitude, longitude) {
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    Number.isNaN(latitude) ||
    Number.isNaN(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("Invalid coordinates");
  }
}

/**
 * @param {Array<{ id: string, name: string, latitude: number, longitude: number, radiusMeters: number }>} locations
 */
export function findNearestWorkLocation(latitude, longitude, locations) {
  if (!locations.length) return null;

  let nearest = null;
  for (const loc of locations) {
    const dist = distanceMeters(latitude, longitude, loc.latitude, loc.longitude);
    const withinRadius = dist <= loc.radiusMeters;
    if (!nearest || dist < nearest.distanceMeters) {
      nearest = {
        location: loc,
        distanceMeters: dist,
        withinRadius,
      };
    }
  }
  return nearest;
}
