import { API_BASE_URL, API_TIMEOUT_MS } from "./apiConfig";

/**
 * Google Places verification (via our backend). Called only when offline +
 * the Local `places` store can't resolve a specific place. Returns multiple
 * candidates — the UI lets the user choose; never auto-pick.
 */
export interface PlaceCandidate {
  name: string;
  address: string;
  placeId: string;
  latitude: number | null;
  longitude: number | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  types: string[];
  phone?: string | null;
  openingHours?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
  website?: string | null;
  googleMapsUri?: string | null;
  businessStatus?: string | null;
  /** Google's single best-fit type, e.g. "lodging". Authoritative when present. */
  primaryType?: string | null;
  /** Google's own Thai label for that type, e.g. "ที่พัก". */
  primaryTypeDisplayName?: string | null;
  /** 0-4, Google's guess at price band. Context only — never the real price. */
  priceLevel?: number | null;
}

export interface VerifyPlacesResult {
  configured: boolean; // false when the backend has no Google key
  candidates: PlaceCandidate[];
}

export async function verifyPlaceOnGoogle(input: {
  placeName: string;
  community?: string | null;
  district?: string | null;
  province?: string | null;
}): Promise<VerifyPlacesResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS * 3);
  try {
    const res = await fetch(`${API_BASE_URL}/places/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(input),
    });
    if (!res.ok) return { configured: false, candidates: [] };
    const data = await res.json();
    return {
      configured: Boolean(data?.configured),
      candidates: Array.isArray(data?.candidates) ? data.candidates : [],
    };
  } catch {
    return { configured: false, candidates: [] };
  } finally {
    clearTimeout(timer);
  }
}
