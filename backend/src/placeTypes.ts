/**
 * Shared Google Places types.
 * -------------------------------------------------------------
 * Lives in its own module because BOTH the AI client (which describes the
 * place block we return to the app) and the places router (which fetches
 * these records from Google) need it — putting it in either one would make
 * the other import across a boundary it shouldn't.
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
