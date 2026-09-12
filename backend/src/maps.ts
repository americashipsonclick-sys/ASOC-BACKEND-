import { config } from "./config";

export const STATIC_MAP_SIZE = "400x220";
export const STATIC_MAP_SCALE = 2;
export const STATIC_MAP_TYPE = "hybrid";

/** One Google Static Maps URL per load. No extra round trip on post. */
export function staticRouteMapUrl(
  pickupLat: number,
  pickupLng: number,
  destLat: number,
  destLng: number,
  key = config.googleMapsKey,
): string | null {
  if (!key) return null;
  if (![pickupLat, pickupLng, destLat, destLng].every(Number.isFinite)) return null;
  const origin = `${pickupLat},${pickupLng}`;
  const dest = `${destLat},${destLng}`;
  const params = new URLSearchParams({
    size: STATIC_MAP_SIZE,
    scale: String(STATIC_MAP_SCALE),
    maptype: STATIC_MAP_TYPE,
    key,
  });
  params.append("markers", `color:0x0F5132|label:A|${origin}`);
  params.append("markers", `color:0x9B1C1C|label:B|${dest}`);
  params.append("path", `color:0x8247E5FF|weight:4|${origin}|${dest}`);
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

export function previewStaticRouteMap(
  pickupLat: number,
  pickupLng: number,
  destLat: number,
  destLng: number,
  key = config.googleMapsKey,
) {
  return {
    configured: Boolean(key),
    url: staticRouteMapUrl(pickupLat, pickupLng, destLat, destLng, key),
    size: STATIC_MAP_SIZE,
    scale: STATIC_MAP_SCALE,
    maptype: STATIC_MAP_TYPE,
    pickup: { lat: pickupLat, lng: pickupLng },
    delivery: { lat: destLat, lng: destLng },
  };
}

/** Turn-by-turn to delivery. Apple Maps on iOS, Google Maps everywhere else. */
export function nativeDirectionsUrl(
  destLat: number,
  destLng: number,
  userAgent = "",
): string | null {
  if (![destLat, destLng].every(Number.isFinite)) return null;
  const dest = `${destLat},${destLng}`;
  if (/iPad|iPhone|iPod/i.test(userAgent)) {
    return `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}&dirflg=d`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`;
}
