import amphoeRaw from "./thailand_amphoe.geojson.json";

/**
 * Thai administrative index (province ↔ district) built from the amphoe
 * GeoJSON — the authoritative list of all 928 districts nationwide.
 * -------------------------------------------------------------
 * Used to validate location names the AI summary returns, fully OFFLINE
 * (no API / no tokens): is this a real province? does this district belong
 * to that province?
 */

interface AmphoeProps {
  districtName: string;
  provinceName: string;
  provinceNameEn?: string;
  districtNameEn?: string;
}

/** Strip Thai admin prefixes/affixes + whitespace for forgiving comparison. */
export function normalizeThaiName(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .replace(/^(จังหวัด|จ\.|อำเภอ|อ\.|ตำบล|ต\.|เขต|แขวง)\s*/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

// Build indexes once at module load.
const provinceSet = new Set<string>(); // normalized province names
const provinceDisplay = new Map<string, string>(); // normalized → original display
const districtsByProvince = new Map<string, Set<string>>(); // normProvince → set(normDistrict)
const districtDisplay = new Map<string, string>(); // normDistrict → original display

for (const f of (amphoeRaw as any).features as { properties: AmphoeProps }[]) {
  const prov = f.properties.provinceName;
  const dist = f.properties.districtName;
  if (!prov || !dist) continue;
  const np = normalizeThaiName(prov);
  const nd = normalizeThaiName(dist);
  provinceSet.add(np);
  if (!provinceDisplay.has(np)) provinceDisplay.set(np, prov.trim());
  if (!districtsByProvince.has(np)) districtsByProvince.set(np, new Set());
  districtsByProvince.get(np)!.add(nd);
  if (!districtDisplay.has(nd)) districtDisplay.set(nd, dist.trim());
}

/** Is this a real Thai province name? */
export function isValidProvince(name?: string | null): boolean {
  return provinceSet.has(normalizeThaiName(name));
}

/** Does `district` belong to `province` (both real + related)? */
export function districtInProvince(district?: string | null, province?: string | null): boolean {
  const np = normalizeThaiName(province);
  const nd = normalizeThaiName(district);
  if (!np || !nd) return false;
  return districtsByProvince.get(np)?.has(nd) ?? false;
}

/** Canonical display name for a province (or the input trimmed if unknown). */
export function canonicalProvince(name?: string | null): string | null {
  const np = normalizeThaiName(name);
  if (!np) return null;
  return provinceDisplay.get(np) ?? ((name ?? "").trim() || null);
}

/** Canonical display name for a district (or the input trimmed if unknown). */
export function canonicalDistrict(name?: string | null): string | null {
  const nd = normalizeThaiName(name);
  if (!nd) return null;
  return districtDisplay.get(nd) ?? ((name ?? "").trim() || null);
}

/** Find which province(s) a district name belongs to (handles ambiguous names). */
export function provincesForDistrict(district?: string | null): string[] {
  const nd = normalizeThaiName(district);
  if (!nd) return [];
  const out: string[] = [];
  for (const [np, set] of districtsByProvince) {
    if (set.has(nd)) {
      const disp = provinceDisplay.get(np);
      if (disp) out.push(disp);
    }
  }
  return out;
}
