/** Great-circle miles. */
export function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 3958.8;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Shortest miles from a point to a route segment (origin → dest). */
export function milesToRoute(
  lat: number,
  lon: number,
  oLat: number,
  oLon: number,
  dLat: number,
  dLon: number,
): number {
  const x = (lon - oLon) * Math.cos(toRad((oLat + dLat) / 2));
  const y = lat - oLat;
  const dx = (dLon - oLon) * Math.cos(toRad((oLat + dLat) / 2));
  const dy = dLat - oLat;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (x * dx + y * dy) / len2));
  const latC = oLat + t * (dLat - oLat);
  const lonC = oLon + t * (dLon - oLon);
  return milesBetween(lat, lon, latC, lonC);
}
