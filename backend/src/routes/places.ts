import { Router, Request, Response } from "express";
import { config, isPlacesConfigured } from "../config";

/**
 * POST /places/verify
 * -------------------------------------------------------------
 * Verify a specific place on Google Maps and return COORDINATES + the admin
 * breakdown (province/district/subdistrict). Returns MULTIPLE candidates when
 * the name is ambiguous — the app lets the user choose (never auto-picks).
 *
 * Body: { placeName, community?, district?, province? }
 * Uses Google Places API (new) Text Search. No-op (empty) when no key is set.
 */

interface PlaceCandidate {
  name: string;
  address: string;
  placeId: string;
  latitude: number | null;
  longitude: number | null;
  province: string | null;
  district: string | null;
  subdistrict: string | null;
  types: string[];
}

const router = Router();

/** Pull Thai admin levels out of Google addressComponents. */
function extractAdmin(components: any[]): {
  province: string | null;
  district: string | null;
  subdistrict: string | null;
} {
  let province: string | null = null;
  let district: string | null = null;
  let subdistrict: string | null = null;
  for (const c of components ?? []) {
    const types: string[] = c.types ?? [];
    const name: string = c.longText ?? c.long_name ?? "";
    if (types.includes("administrative_area_level_1")) province = name;
    else if (types.includes("administrative_area_level_2")) district = name;
    else if (types.includes("administrative_area_level_3") || types.includes("sublocality_level_1"))
      subdistrict = name;
  }
  return { province, district, subdistrict };
}

router.post("/verify", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const placeName: string = (body.placeName ?? "").toString().trim();
  const parts = [placeName, body.community, body.district, body.province]
    .filter((x: unknown) => typeof x === "string" && (x as string).trim())
    .join(" ");

  if (!placeName) {
    return res.status(400).json({ error: "placeName is required" });
  }
  if (!isPlacesConfigured()) {
    // Graceful: no key configured → tell the app to fall back to manual.
    return res.json({ configured: false, candidates: [] as PlaceCandidate[] });
  }

  try {
    const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": config.places.googleKey,
        // Only request the fields we use (keeps cost + payload small).
        "X-Goog-FieldMask":
          "places.displayName,places.formattedAddress,places.id,places.location,places.types,places.addressComponents",
      },
      body: JSON.stringify({
        textQuery: `${parts} ประเทศไทย`,
        languageCode: "th",
        regionCode: "TH",
        maxResultCount: 5,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return res.status(502).json({ error: `Google Places error ${resp.status}: ${errText.slice(0, 200)}` });
    }

    const data: any = await resp.json();
    const candidates: PlaceCandidate[] = (data.places ?? []).map((p: any) => {
      const admin = extractAdmin(p.addressComponents);
      return {
        name: p.displayName?.text ?? placeName,
        address: p.formattedAddress ?? "",
        placeId: p.id ?? "",
        latitude: p.location?.latitude ?? null,
        longitude: p.location?.longitude ?? null,
        province: admin.province,
        district: admin.district,
        subdistrict: admin.subdistrict,
        types: p.types ?? [],
      };
    });

    return res.json({ configured: true, candidates });
  } catch (err: any) {
    const message = err?.name === "AbortError" ? "หมดเวลาเชื่อมต่อ Google" : err?.message || "ค้นหาสถานที่ไม่สำเร็จ";
    return res.status(502).json({ error: message });
  }
});

export default router;
