import { milesBetween, milesToRoute } from "./geo";

export type DriverMatchInput = {
  driverId: string;
  phone: string;
  verified: boolean;
  vehicleType: string;
  lat: number | null;
  lng: number | null;
  routeOriginLat: number | null;
  routeOriginLng: number | null;
  routeDestLat: number | null;
  routeDestLng: number | null;
};

export type LoadMatchInput = {
  loadId: string;
  pickupLat: number | null;
  pickupLng: number | null;
  equipment: string;
  originLabel: string;
  destLabel: string;
  rate: string;
};

export type MatchHit = {
  driverId: string;
  phone: string;
  milesAway: number;
};

const CLAIM_WORDS = /^(yes|y|claim|accept|book|book it|take it)$/i;

export function isClaimReply(body: string): boolean {
  return CLAIM_WORDS.test(body.trim());
}

export function vehicleFits(driverType: string, loadEquipment: string): boolean {
  const want = loadEquipment.trim().toLowerCase();
  const have = driverType.trim().toLowerCase();
  if (!want || !have) return true;
  return have === want || have.includes(want) || want.includes(have);
}

export function distanceToLoad(driver: DriverMatchInput, load: LoadMatchInput): number | null {
  if (load.pickupLat == null || load.pickupLng == null) return null;
  const distances: number[] = [];
  if (driver.lat != null && driver.lng != null) {
    distances.push(milesBetween(load.pickupLat, load.pickupLng, driver.lat, driver.lng));
  }
  if (
    driver.routeOriginLat != null &&
    driver.routeOriginLng != null &&
    driver.routeDestLat != null &&
    driver.routeDestLng != null
  ) {
    distances.push(
      milesToRoute(
        load.pickupLat,
        load.pickupLng,
        driver.routeOriginLat,
        driver.routeOriginLng,
        driver.routeDestLat,
        driver.routeDestLng,
      ),
    );
  }
  if (distances.length === 0) return null;
  return Math.min(...distances);
}

export function matchDrivers(
  drivers: DriverMatchInput[],
  load: LoadMatchInput,
  radiusMiles: number,
): MatchHit[] {
  const hits: MatchHit[] = [];
  for (const driver of drivers) {
    if (!driver.verified || !driver.phone) continue;
    if (!vehicleFits(driver.vehicleType, load.equipment)) continue;
    const miles = distanceToLoad(driver, load);
    if (miles == null || miles > radiusMiles) continue;
    hits.push({ driverId: driver.driverId, phone: driver.phone, milesAway: miles });
  }
  return hits.sort((a, b) => a.milesAway - b.milesAway);
}

export function smsCopy(load: LoadMatchInput, milesAway: number, claimUrl: string): string {
  const pay = load.rate ? `Pay ${load.rate}. ` : "";
  const route = [load.originLabel, load.destLabel].filter(Boolean).join(" → ") || load.loadId;
  return `ASOC: New load ${milesAway.toFixed(0)} mi away. ${pay}${route}. Reply YES to claim or tap ${claimUrl}`;
}
