import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  MapPinIcon,
  FolderIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  ClockIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  TrashIcon,
  CheckIcon,
  TruckIcon,
  SparklesIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
} from "react-native-heroicons/outline";

import { useAiPlanner } from "../../state/AiPlannerContext";
import {
  ItineraryDay,
  ItineraryStop,
  TRAVEL_STYLES,
  TravelStyle,
  Trip,
  TripBudget,
  TripPlanLeg,
  TripPlanPoint,
} from "../../data/tripsData";
import OriginSelectorModal from "../../components/OriginSelectorModal";
import TripTimeSheet from "../../components/TripTimeSheet";
import TripAiPlaceSheet, {
  type AiPickedPlace,
  type AiPlaceAnchor,
} from "../../components/TripAiPlaceSheet";
import { getMyFolders, type Folder } from "../../services/folderService";
import {
  getFolderContext,
  type FolderPlaceInfo,
} from "../../services/folderContextService";
import { findLocalPlaces, type LocalPlace } from "../../services/placesLocalService";
import { resolvePlaceCoords } from "../../services/placesService";
import {
  computeRoute,
  haversineKm,
  type LatLng,
  type RouteResult,
} from "../../services/tripRouteService";
import { createMyTripPlan } from "../../services/tripPlanService";

/**
 * สร้างแพลนทริปด้วยตัวเอง (ไม่ใช้ AI)
 * =============================================================
 * · จุดเริ่มต้น = จุดที่บันทึกไว้ (OriginSelectorModal)
 * · สถานที่ = เลือกจากโฟลเดอร์ หรือใส่เอง (ค้นหาในทะเบียนของแอป / วางลิงก์ Google Maps)
 * · เส้นทาง + เวลาเดินทาง = คำนวณฝั่งแอป (OSRM สาธารณะ + คำนวณสำรอง)
 * · ผลลัพธ์ = `Trip` รูปแบบเดียวกับแพลนที่ AI ทำ (ดู `buildTrip` ท้ายไฟล์)
 *   → บันทึกลง `trip_plans` → แก้ไขต่อในหน้าแพลนได้เลย
 */

type Step = 1 | 2 | 3 | 4;

const STEPS: { key: Step; title: string; hint: string }[] = [
  { key: 1, title: "จุดเริ่มต้น", hint: "เลือกจากที่บันทึกไว้" },
  { key: 2, title: "สถานที่", hint: "จากโฟลเดอร์ หรือใส่เอง" },
  { key: 3, title: "ลำดับและเวลา", hint: "จัดรูทและกำหนดเวลา" },
  { key: 4, title: "สรุป", hint: "ตรวจแล้วกดสร้างแพลน" },
];

/** จุดหนึ่งจุดที่ผู้ใช้เลือก (จากโฟลเดอร์หรือใส่เอง) */
interface PlanPlace {
  key: string;
  name: string;
  address?: string | null;
  coords?: LatLng | null;
  /** ที่มา: registry = ยืนยันในทะเบียน · clip = มาจากคลิปในโฟลเดอร์ · manual = ใส่เอง */
  source: "registry" | "clip" | "manual";
  communityName?: string | null;
  clipCount?: number;
  /** จังหวัด (ใช้หาสถานที่ใกล้เคียงในจังหวัดเดียวกัน) */
  province?: string | null;
  /** กำลังหาพิกัดอยู่ (เพิ่มสถานที่เอง — หาพิกัดเบื้องหลัง) */
  resolving?: boolean;
}

/**
 * รูปแบบ folderPlaces ที่ backend เก็บไว้ใน `itinerary_data.__meta`
 * (คนละชื่อกับ TripFolderPlace ของฝั่งแอป — ดู folderPlacesFromMeta ใน tripPlanService)
 *
 * ต้องประกาศ type ให้ชัด เพราะ "source" ต้องเป็น "registry" | "clip" เท่านั้น
 * (ถ้าปล่อยให้ TS เดาจาก object literal มันกว้างเป็น string → ตอนอ่านกลับมาไม่ผ่าน)
 */
interface FolderPlaceMeta {
  name: string;
  source: "registry" | "clip";
  clips: number;
  community: string | null;
  address: string | null;
}

interface OriginChoice {
  label: string;
  address: string;
  url?: string;
  coords?: { lat: number; lng: number } | null;
}

/**
 * แท็ก/ชื่อที่ “ทั่วไป” เกินไปสำหรับการค้นหาพิกัด
 * (เช่น “บ้าน” → จะไปตรงกับบ้านหลังอื่นในเมืองแทน)
 */
const GENERIC_LABELS = ["บ้าน", "หอพัก", "ที่ทำงาน", "จุดนัดพบ", "จุดเริ่มต้น"];

function addMinutes(time: string, mins: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((time ?? "").trim());
  const base = m ? Number(m[1]) * 60 + Number(m[2]) : 8 * 60;
  const total = Math.max(0, Math.min(24 * 60 - 1, base + Math.round(mins)));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** เรียงจุดแบบ nearest-neighbour (เริ่มจากจุดเริ่มต้น) — จุดที่ไม่มีพิกัดไปท้ายสุด */
function orderByProximity(origin: LatLng | null, places: PlanPlace[]): PlanPlace[] {
  const withCoords = places.filter((p) => !!p.coords);
  const without = places.filter((p) => !p.coords);
  const pool = [...withCoords];
  const out: PlanPlace[] = [];
  let cur = origin;
  while (pool.length) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    pool.forEach((p, i) => {
      const d = cur ? haversineKm(cur, p.coords!) : 0;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    const picked = pool.splice(bestIdx, 1)[0];
    out.push(picked);
    cur = picked.coords ?? cur;
  }
  return [...out, ...without];
}

function kmText(km: number): string {
  return `${km.toFixed(1)} กม.`;
}

function minutesText(mins: number): string {
  if (mins < 60) return `${mins} นาที`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
}

export default function ManualTripPlanner({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (tripId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { addTrip } = useAiPlanner();

  const [step, setStep] = useState<Step>(1);

  // ── ขั้นที่ 1: จุดเริ่มต้น ───────────────────────────────────────────
  const [origin, setOrigin] = useState<OriginChoice | null>(null);
  const [originModal, setOriginModal] = useState(false);
  const [originResolving, setOriginResolving] = useState(false);
  const [originLink, setOriginLink] = useState("");
  /**
   * จุดกลับ (จุดจบของทริป) — ค่าเริ่มต้น = กลับจุดเริ่มต้น
   * -------------------------------------------------------------
   * เก็บแยกไว้ตั้งแต่แรก เผื่อรอบหน้าให้ผู้ใช้เลือกจุดกลับเองได้
   * โดยไม่ต้องแก้รูปแบบข้อมูลของแพลน
   */
  const [customEnd, setCustomEnd] = useState<OriginChoice | null>(null);
  /** โมดัลเลือก "จุดกลับ" (ค่าเริ่มต้น = กลับจุดเริ่มต้น) */
  const [endModal, setEndModal] = useState(false);
  /** กำลังหาพิกัดจุดกลับ */
  const [endResolving, setEndResolving] = useState(false);

  // ── ขั้นที่ 2: สถานที่ (หน้าเดียว — โฟลเดอร์ + ค้นหา/ใส่เอง) ──────────
  /**
   * ช่องค้นหา/ใส่สถานที่เอง mount แล้วหรือยัง
   * -------------------------------------------------------------
   * บน iOS ถ้า mount ช่องกรอก (TextInput = native view หนัก) ใน commit เดียวกับ
   * ที่ mount ส่วนอื่นของขั้นที่ 2 แอปจะค้าง (JS thread ติด → เลื่อนได้แต่กดปุ่มไม่ได้)
   * → เลย mount แยก commit: commit แรกขึ้นโฟลเดอร์ก่อน
   *   commit ถัดไป (tick หลัง) ค่อย mount ช่องกรอก
   */
  const [formReady, setFormReady] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  // เริ่มเป็น “กำลังโหลด” ตั้งแต่แรก (ไม่ต้อง setState ใน effect — React Compiler
  // บ่นว่า setState ตรง ๆ ใน effect แล้ว render ซ้ำ)
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderPlaces, setFolderPlaces] = useState<FolderPlaceInfo[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [places, setPlaces] = useState<PlanPlace[]>([]);

  const [manualQuery, setManualQuery] = useState("");
  const [localHits, setLocalHits] = useState<LocalPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualLink, setManualLink] = useState("");
  /** ชีต "เพิ่มสถานที่ด้วย AI" */
  const [aiSheetOpen, setAiSheetOpen] = useState(false);

  // ── ขั้นที่ 3: ลำดับ/เวลา/งบ ────────────────────────────────────────
  const [startTime, setStartTime] = useState("08:00");
  const [timeSheet, setTimeSheet] = useState(false);
  const [style, setStyle] = useState<TravelStyle>("slowlife");
  const [budget, setBudget] = useState("");
  const [planName, setPlanName] = useState("");

  // ── ขั้นที่ 4: สรุป ──────────────────────────────────────────────────
  const [route, setRoute] = useState<RouteResult | null>(null);
  /**
   * จุดกลับที่เส้นทางปัจจุบันคำนวณมา
   * → กันกรณีผู้ใช้เพิ่งเปลี่ยนจุดกลับ แล้วกดสร้างแพลนทันที (เส้นทางยังเป็นของเดิม)
   */
  const [routeEndLabel, setRouteEndLabel] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  // ── เข้าขั้นที่ 2: mount ช่องกรอกแยก commit (iOS) ──────────────────────
  useEffect(() => {
    if (step !== 2 || formReady) return;
    // เลื่อนไปเฟรมถัดไป — ไม่อัปเดต state ระหว่างที่ React กำลัง render
    // (ให้ native view ของ commit แรกเข้าจอเสร็จก่อน ค่อย mount ช่องกรอก)
    const timer = setTimeout(() => {
      requestAnimationFrame(() => setFormReady(true));
    }, 0);
    return () => clearTimeout(timer);
  }, [step, formReady]);

  /**
   * เปลี่ยนขั้นตอน
   * -------------------------------------------------------------
   * ออกจากขั้นที่ 2 → รีเซ็ตช่องกรอก เพื่อให้กลับเข้ามาแล้ว mount ใหม่
   * (mount TextInput พร้อมกับส่วนอื่นของขั้นที่ 2 → iOS ค้าง)
   */
  const goStep = (next: Step) => {
    if (next !== 2) setFormReady(false);
    setStep(next);
  };

  // ── โหลดโฟลเดอร์ของฉัน (ครั้งเดียว) ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getMyFolders();
        if (!cancelled) {
          setFolders(list);
        }
      } catch {
        // โหลดโฟลเดอร์ไม่ได้ → ไม่พังหน้าจอ ใช้แท็บ “ใส่เอง” แทน
      } finally {
        if (!cancelled) setFoldersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── เลือกโฟลเดอร์ → ดึงสถานที่ในโฟลเดอร์ ─────────────────────────────
  const loadFolder = useCallback(async (id: string) => {
    setFolderId(id);
    setFolderLoading(true);
    try {
      const ctx = await getFolderContext(id);
      setFolderPlaces(ctx?.places ?? []);
    } catch {
      // โหลดสถานที่ในโฟลเดอร์ไม่สำเร็จ → ปล่อยว่างไว้ ไม่ให้หน้าจอพัง
      setFolderPlaces([]);
    } finally {
      setFolderLoading(false);
    }
  }, []);

  const toggleFolderPlace = (p: FolderPlaceInfo) => {
    const key = `f-${p.key}`;
    setPlaces((prev) => {
      if (prev.some((x) => x.key === key)) {
        return prev.filter((x) => x.key !== key);
      }
      const coords =
        p.latitude != null && p.longitude != null
          ? { lat: p.latitude, lng: p.longitude }
          : null;
      return [
        ...prev,
        {
          key,
          name: p.name,
          address: p.address,
          coords,
          source: p.source === "registry" ? "registry" : "clip",
          communityName: p.communityName,
          clipCount: p.clipCount,
          province: p.province ?? null,
        },
      ];
    });
  };

  // ── ค้นหาสถานที่ในทะเบียนของแอป ──────────────────────────────────────
  const searchLocal = async () => {
    const q = manualQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const hits = await findLocalPlaces({ name: q });
      setLocalHits(hits);
    } catch {
      setLocalHits([]);
    } finally {
      setSearching(false);
    }
  };

  const addLocalHit = (hit: LocalPlace) => {
    const coords =
      hit.latitude != null && hit.longitude != null
        ? { lat: hit.latitude, lng: hit.longitude }
        : null;
    setPlaces((prev) => [
      ...prev,
      {
        key: `m-${hit.id}-${Date.now()}`,
        name: hit.name,
        address: [hit.community, hit.district, hit.province].filter(Boolean).join(" · ") || null,
        coords,
        source: "manual",
        communityName: hit.community,
        province: hit.province ?? null,
      },
    ]);
    setManualQuery("");
    setLocalHits([]);
  };

  /**
   * ใส่สถานที่เอง: ชื่อ + ลิงก์ Google Maps (หาพิกัดให้อัตโนมัติ)
   * -------------------------------------------------------------
   * เพิ่มลงรายการ **ทันที** แล้วค่อยหาพิกัดเบื้องหลัง
   * (เดิมรอ backend ก่อนเพิ่ม → หน้าจอดูเหมือนค้าง ปุ่มกดซ้ำไม่ได้)
   */
  const addManualPlace = () => {
    const name = manualName.trim();
    const link = manualLink.trim();
    if (!name && !link) {
      Alert.alert("ยังไม่ได้ใส่สถานที่", "พิมพ์ชื่อสถานที่ หรือวางลิงก์ Google Maps");
      return;
    }

    const key = `m-manual-${Date.now()}`;
    const label = name || "สถานที่ที่เพิ่มเอง";
    setPlaces((prev) => [
      ...prev,
      { key, name: label, address: null, coords: null, source: "manual", resolving: true },
    ]);
    setManualName("");
    setManualLink("");

    // หาพิกัดเบื้องหลัง — ไม่บล็อกหน้าจอ
    void (async () => {
      try {
        const resolved = await resolvePlaceCoords({
          url: link || null,
          text: link ? null : name,
        });
        if (resolved) {
          setPlaces((prev) =>
            prev.map((p) =>
              p.key === key
                ? {
                    ...p,
                    name: p.name === "สถานที่ที่เพิ่มเอง" && resolved.label ? resolved.label : p.name,
                    coords: { lat: resolved.lat, lng: resolved.lng },
                    resolving: false,
                  }
                : p
            )
          );
        } else {
          setPlaces((prev) =>
            prev.map((p) => (p.key === key ? { ...p, resolving: false } : p))
          );
          Alert.alert(
            "ยังหาพิกัดไม่ได้",
            "เพิ่มสถานที่แล้ว แต่ยังไม่มีพิกัด — จะไม่แสดงบนแผนที่ (พิมพ์ชื่อหรือวางลิงก์ Google Maps ที่หาพิกัดได้)"
          );
        }
      } catch {
        setPlaces((prev) =>
          prev.map((p) => (p.key === key ? { ...p, resolving: false } : p))
        );
        Alert.alert(
          "ยังหาพิกัดไม่ได้",
          "เพิ่มสถานที่แล้ว แต่ยังไม่มีพิกัด — จะไม่แสดงบนแผนที่ (ต่อเน็ตใหม่แล้วลองใส่ลิงก์ Google Maps อีกครั้ง)"
        );
      }
    })();
  };

  const movePlace = (index: number, dir: -1 | 1) => {
    setPlaces((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const removePlace = (key: string) => {
    setPlaces((prev) => prev.filter((p) => p.key !== key));
  };

  const autoOrder = () => {
    const originCoords =
      origin?.coords && origin.coords.lat !== 0
        ? { lat: origin.coords.lat, lng: origin.coords.lng }
        : null;
    setPlaces((prev) => orderByProximity(originCoords, prev));
  };

  /**
   * เพิ่มสถานที่ที่เลือกจากชีต "เพิ่มสถานที่ด้วย AI" ลงแผน
   * → ตัดชื่อที่ซ้ำกับที่มีอยู่แล้วออกก่อน (ไม่ให้เพิ่มซ้ำ)
   */
  const handleAiAdd = (picked: AiPickedPlace[]) => {
    // คำนวณนอก updater — Date.now() ห้ามอยู่ในโค้ดที่รันตอน render (กฎ react-hooks/purity)
    const stamp = Date.now();
    setPlaces((prev) => {
      const existing = new Set(prev.map((p) => p.name.trim().toLowerCase()));
      const add: PlanPlace[] = [];
      picked.forEach((p, i) => {
        const key = p.name.trim().toLowerCase();
        if (existing.has(key)) return;
        existing.add(key);
        add.push({
          key: `ai-${stamp}-${i}`,
          name: p.name,
          address: p.address ?? null,
          coords: p.coords,
          source: p.source,
          province: p.province ?? null,
        });
      });
      return add.length ? [...prev, ...add] : prev;
    });
  };

  // ── จุดเริ่มต้นที่เลือก: ถ้าไม่มีพิกัด → ลองหาพิกัดให้อัตโนมัติ ──────
  // หมายเหตุ: โชว์จุดเริ่มต้นทันที (ไม่รอหาพิกัด) แล้วค่อยเติมพิกัดทีหลัง
  // เพราะการรอ backend ทำให้หน้าจอดูเหมือนค้าง และปุ่ม “ถัดไป” กดไม่ได้เลย
  const pickOrigin = async (choice: OriginChoice) => {
    if (choice.coords && choice.coords.lat !== 0) {
      setOrigin({ ...choice, coords: choice.coords });
      return;
    }

    // เอาข้อความไว้หาพิกัดก่อน (ใช้ที่อยู่จริง — ไม่ใช้แท็กทั่วไป เช่น “บ้าน”
    // ไม่งั้นจะค้นไปเจอสถานที่อื่นที่ชื่อเหมือนกันแล้กลายเป็นจุดเริ่มต้นผิด)
    const address = choice.address?.trim() ?? "";
    const label = choice.label?.trim() ?? "";
    const searchText =
      address && !GENERIC_LABELS.includes(address)
        ? address
        : label && !GENERIC_LABELS.includes(label)
        ? label
        : null;

    setOrigin({ ...choice, coords: null });
    setOriginResolving(true);
    try {
      const resolved = await resolvePlaceCoords({
        url: choice.url ?? null,
        text: searchText,
      });
      if (resolved) {
        setOrigin({ ...choice, coords: { lat: resolved.lat, lng: resolved.lng } });
      } else {
        Alert.alert(
          "จุดเริ่มต้นยังไม่มีพิกัด",
          "ไปต่อได้ แต่เส้นทางจะเป็นค่าประมาณ\n" +
            "ถ้าอยากได้เส้นทางจริง ใส่ลิงก์ Google Maps ของจุดเริ่มต้นไว้ด้านล่าง"
        );
      }
    } catch {
      Alert.alert(
        "หาพิกัดไม่สำเร็จ",
        "ไปต่อได้ แต่เส้นทางจะเป็นค่าประมาณ (ต่อเน็ตใหม่แล้วลองหาพิกัดอีกครั้ง)"
      );
    } finally {
      setOriginResolving(false);
    }
  };

  /**
   * เลือก "จุดกลับ" (ค่าเริ่มต้น = กลับจุดเริ่มต้น)
   * -------------------------------------------------------------
   * เหมือนจุดเริ่มต้น: โชว์ทันที แล้วค่อยหาพิกัดเบื้องหลัง (ไม่ให้หน้าจอดูเหมือนค้าง)
   */
  const pickEnd = async (choice: OriginChoice) => {
    if (choice.coords && choice.coords.lat !== 0) {
      setCustomEnd({ ...choice, coords: choice.coords });
      return;
    }

    const address = choice.address?.trim() ?? "";
    const label = choice.label?.trim() ?? "";
    const searchText =
      address && !GENERIC_LABELS.includes(address)
        ? address
        : label && !GENERIC_LABELS.includes(label)
        ? label
        : null;

    setCustomEnd({ ...choice, coords: null });
    setEndResolving(true);
    try {
      const resolved = await resolvePlaceCoords({
        url: choice.url ?? null,
        text: searchText,
      });
      if (resolved) {
        setCustomEnd({ ...choice, coords: { lat: resolved.lat, lng: resolved.lng } });
      } else {
        Alert.alert(
          "จุดกลับยังไม่มีพิกัด",
          "ไปต่อได้ แต่เส้นทางจะเป็นค่าประมาณ"
        );
      }
    } catch {
      Alert.alert(
        "หาพิกัดไม่สำเร็จ",
        "ไปต่อได้ แต่เส้นทางจะเป็นค่าประมาณ (ต่อเน็ตใหม่แล้วลองหาพิกัดอีกครั้ง)"
      );
    } finally {
      setEndResolving(false);
    }
  };

  /** หาพิกัดจุดเริ่มต้นจากลิงก์ที่ผู้ใช้วางเอง */
  const resolveOriginLink = async () => {
    const link = originLink.trim();
    if (!link) return;
    setOriginResolving(true);
    try {
      const resolved = await resolvePlaceCoords({ url: link });
      if (!resolved) {
        Alert.alert("หาพิกัดไม่ได้", "ลิงก์นี้หาพิกัดไม่ได้ — ลองอีกครั้งหรือเลือกใหม่");
        return;
      }
      setOrigin({
        label: resolved.label || origin?.label || "จุดเริ่มต้น",
        address: origin?.address ?? "",
        url: link,
        coords: { lat: resolved.lat, lng: resolved.lng },
      });
    } catch {
      Alert.alert("หาพิกัดไม่สำเร็จ", "ต่อเน็ตใหม่แล้วลองอีกครั้ง");
    } finally {
      setOriginResolving(false);
    }
  };

  // ── คำนวณเส้นทาง (ตอนเข้าสู่ขั้นที่ 4) ─────────────────────────────────
  const calcRoute = useCallback(async (): Promise<RouteResult | null> => {
    if (!origin) return null;
    // จุดกลับ = จุดที่ผู้ใช้เลือกไว้ ถ้ามี งั้นใช้จุดเริ่มต้น
    const end = customEnd ?? origin;
    const endCoords =
      end.coords && end.coords.lat !== 0
        ? { lat: end.coords.lat, lng: end.coords.lng }
        : null;
    setRouteLoading(true);
    try {
      const points = [
        {
          label: origin.label,
          coords: origin.coords && origin.coords.lat !== 0 ? origin.coords : null,
        },
        ...places.map((p) => ({
          label: p.name,
          coords: p.coords ?? null,
        })),
        // จบที่จุดกลับ (ค่าเริ่มต้น = กลับจุดเริ่มต้น)
        {
          label: end.label,
          coords: endCoords,
        },
      ];
      // จุดที่ไม่มีพิกัดถูกข้ามไปเอง (ดู computeRoute) → ไม่มีพิกัดก็ยังได้ค่าประมาณ
      const result = await computeRoute(points);
      setRoute(result);
      setRouteEndLabel(end.label);
      return result;
    } catch {
      return null;
    } finally {
      setRouteLoading(false);
    }
  }, [origin, places, customEnd]);

  useEffect(() => {
    if (step !== 4) return;
    // เลื่อนไปคำนวณใน tick ถัดไป — ไม่อัปเดต state ระหว่างที่ React กำลัง render
    const timer = setTimeout(() => {
      void calcRoute();
    }, 0);
    return () => clearTimeout(timer);
  }, [step, calcRoute]);

  // ── สร้างแพลน ────────────────────────────────────────────────────────
  const createPlan = async () => {
    if (!origin) {
      Alert.alert("ยังไม่ได้เลือกจุดเริ่มต้น", "กลับไปเลือกจุดเริ่มต้นก่อน");
      goStep(1);
      return;
    }
    if (!places.length) {
      Alert.alert("ยังไม่ได้เลือกสถานที่", "เพิ่มสถานที่อย่างน้อย 1 แห่งก่อนสร้างแพลน");
      goStep(2);
      return;
    }

    // จุดเริ่มต้นที่ไม่มีพิกัดก็ยังสร้างแพลนได้ (เส้นทางเป็นค่าประมาณ)
    const originPointCoords =
      origin.coords && origin.coords.lat !== 0
        ? { lat: origin.coords.lat, lng: origin.coords.lng }
        : null;

    // จุดกลับ = จุดที่ผู้ใช้เลือกไว้ ถ้ามี งั้นกลับจุดเริ่มต้น
    const end = customEnd ?? origin;
    const endPointCoords =
      end.coords && end.coords.lat !== 0
        ? { lat: end.coords.lat, lng: end.coords.lng }
        : null;
    const isSameAsStart = !customEnd || customEnd.label === origin.label;

    setCreating(true);
    try {
      const result =
        route && routeEndLabel === end.label ? route : (await calcRoute());
      const legs: TripPlanLeg[] = result?.legs ?? [];
      const totalKm = result?.totalKm ?? 0;
      const totalDriveMinutes = result?.totalDriveMinutes ?? 0;
      const routeSource = result?.routeSource ?? "estimate";
      const routeCredit = result?.routeCredit;

      const originPoint: TripPlanPoint = {
        label: origin.label,
        address: origin.address || null,
        coords: originPointCoords,
      };

      const endPoint: TripPlanPoint = {
        label: end.label,
        address: end.address || null,
        coords: endPointCoords,
      };

      // ── ไทม์ไลน์ของวัน (รูปแบบเดียวกับแพลน AI) ────────────────────
      const stops: ItineraryStop[] = [];
      let clock = startTime;
      places.forEach((p, i) => {
        const legIn = legs.find((l) => l.toIndex === i + 1);
        const legOut = legs.find((l) => l.fromIndex === i + 1);
        const driveIn = legIn?.minutes ?? 0;
        const arrive = addMinutes(clock, driveIn + 10);
        const stayHours = 1;
        const leave = addMinutes(arrive, stayHours * 60);
        stops.push({
          name: p.name,
          activity: "",
          stayHours,
          driveToNextMins: legOut?.minutes ?? 0,
          startTime: arrive,
          endTime: leave,
          arriveTime: arrive,
          leaveTime: leave,
          type: "attraction",
          coordinates: p.coords ?? undefined,
          distanceFromPrevKm: legIn?.km ?? null,
          note: p.address ?? undefined,
        });
        clock = leave;
      });

      // จุดสุดท้าย = จุดกลับ (ค่าเริ่มต้น = กลับจุดเริ่มต้น)
      const lastLeg = legs.find((l) => l.toIndex === places.length + 1);
      stops.push({
        name: `กลับ ${end.label}`,
        activity: "",
        stayHours: 0,
        driveToNextMins: 0,
        startTime: clock,
        endTime: clock,
        arriveTime: clock,
        leaveTime: clock,
        type: "return",
        coordinates: endPointCoords ?? undefined,
        distanceFromPrevKm: lastLeg?.km ?? null,
        note: "จุดสิ้นสุดของวัน",
      });

      const day: ItineraryDay = {
        day: 1,
        stops,
        startPoint: originPoint,
        endPoint,
        endPointType: "return",
        legs,
        totalKm,
        totalDriveMinutes,
        warnings: [],
      };

      const fuelCost = Math.round(totalKm * 8);
      const budgetPerPerson = Number(budget) || 0;
      const tripBudget: TripBudget = {
        lodging: 0,
        fuel: fuelCost,
        food: 0,
        total: fuelCost,
        perPerson: budgetPerPerson,
        withinBudget: true,
      };

      const title =
        planName.trim() ||
        (places.length ? `ทริป ${places[0].name}` : "แพลนทริปของฉัน");

      const summary =
        `แพลนที่คุณจัดเอง · ${places.length} จุด · ${kmText(totalKm)} · ` +
        `เวลาเดินทาง ${minutesText(totalDriveMinutes)}`;

      const folderMeta: FolderPlaceMeta[] = folderId
        ? folderPlaces.map((p) => ({
            name: p.name,
            source: p.source === "registry" ? "registry" : "clip",
            clips: p.clipCount,
            community: p.communityName,
            address: p.address,
          }))
        : [];

      const itineraryData = {
        days: [day],
        summary,
        startPoint: originPoint,
        endPoint,
        returnMode: isSameAsStart ? "same_as_start" : "custom",
        startTime,
        budget: tripBudget,
        budgetPerPerson,
        travelers: 1,
        daysCount: 1,
        routeSource,
        routeCredit,
        __meta: {
          appStatus: "draft",
          destinations: places.map((p) => p.name),
          folderPlaces: folderMeta,
          returnMode: isSameAsStart ? "same_as_start" : "custom",
          createdByUser: true,
        },
      };

      // บันทึกลง `trip_plans` (RLS อนุญาตให้ผู้ใช้เขียนแผนของตัวเอง)
      const planId = await createMyTripPlan({
        planName: title,
        startLocation: origin.label,
        returnLocation: end.label,
        sourceFolderId: folderId,
        budgetLimit: budgetPerPerson || null,
        travelStyle: TRAVEL_STYLES.find((s) => s.key === style)?.label ?? null,
        itineraryData,
      });

      const trip: Trip = {
        id: planId ?? `trip-manual-${Date.now()}`,
        planId: planId ?? undefined,
        title,
        summary,
        status: "draft",
        startPoint: origin.label,
        startPointCoords: originPointCoords ?? undefined,
        startTime,
        travelers: 1,
        destinations: places.map((p) => p.name),
        days: 1,
        nights: 0,
        budgetPerPerson,
        style,
        itinerary: [day],
        budget: tripBudget,
        sourceFolderId: folderId ?? undefined,
        folderPlaces: folderMeta.length
          ? folderMeta.map((p) => ({
              name: p.name,
              source: p.source,
              clipCount: p.clips,
              communityName: p.community,
              address: p.address,
            }))
          : undefined,
        createdAt: Date.now(),
        returnMode: isSameAsStart ? "same_as_start" : "custom",
        endPoint: end.label,
        endPointCoords: endPointCoords ?? undefined,
        routeSource,
        routeCredit,
      };

      addTrip(trip);

      if (!planId) {
        Alert.alert(
          "บันทึกลงเซิร์ฟเวอร์ไม่สำเร็จ",
          "แพลนยังอยู่ในเครื่องนี้ แต่จะหายเมื่อปิดแอป — ลองเช็กว่าล็อกอินอยู่แล้วหรือยัง"
        );
      }
      onCreated(trip.id);
    } catch (e: any) {
      // เคยเป็นการ “เด้งออก” จากหน้านี้ เพราะ error ไปหลุดเป็น promise ที่ไม่มีใครรับ
      Alert.alert(
        "สร้างแพลนไม่สำเร็จ",
        e?.message ?? "เกิดข้อผิดพลาดระหว่างสร้างแพลน — ลองอีกครั้ง"
      );
    } finally {
      setCreating(false);
    }
  };

  // ── UI เล็ก ๆ ────────────────────────────────────────────────────────
  const originCoords: LatLng | null =
    origin?.coords && origin.coords.lat !== 0
      ? { lat: origin.coords.lat, lng: origin.coords.lng }
      : null;

  /**
   * จุดอ้างอิงของชีต AI = สถานที่ที่ผู้ใช้เลือกไว้ในขั้นที่ 2 (เฉพาะจุดที่มีพิกัด)
   * -------------------------------------------------------------
   * ตามที่ผู้ใช้บอก: ให้หา "ใกล้เคียงที่เลือกไว้ในขั้นที่ 2"
   * ไม่ใช่รอบจุดเริ่มต้น/ตำแหน่งที่บันทึกไว้
   */
  const aiAnchors: AiPlaceAnchor[] = places
    .filter((p) => p.coords)
    .map((p) => ({
      label: p.name,
      coords: p.coords!,
      address: p.address ?? null,
      province: p.province ?? null,
    }));

  // คำนวณตรง ๆ (ไม่ห่อ useMemo) — object ขนาดเล็ก และให้ React Compiler จัดการเอง
  const stepDone = {
    1: !!origin,
    2: places.length > 0,
    3: true,
    4: false,
  };

  // ขั้นที่ 1 ผ่านได้ตราบใดที่ “เลือกจุดเริ่มต้นแล้ว” — ไม่บังคับว่าต้องมีพิกัด
  // (ถ้าบังคับ ปุ่ม “ถัดไป” จะกดไม่ได้เลย → ผู้ใช้ติดค้างที่ขั้นที่ 1)
  const canNext =
    step === 1 ? !!origin : step === 2 ? places.length > 0 : true;

  const renderStepper = () => (
    <View className="flex-row px-4 pb-2">
      {STEPS.map((s, i) => {
        const active = step === s.key;
        const done = stepDone[s.key];
        return (
          <TouchableOpacity
            key={s.key}
            onPress={() => goStep(s.key)}
            activeOpacity={0.7}
            className="flex-1 items-center mx-0.5"
          >
            <View
              className={`w-7 h-7 rounded-full items-center justify-center ${
                active
                  ? "bg-violet-600"
                  : done
                  ? "bg-emerald-100"
                  : "bg-gray-100"
              }`}
            >
              {done && !active ? (
                <CheckIcon size={14} color="#2D6A4F" />
              ) : (
                <Text
                  className={`text-[12px] font-black ${
                    active ? "text-white" : "text-gray-500"
                  }`}
                >
                  {s.key}
                </Text>
              )}
            </View>
            <Text
              className={`text-[10.5px] mt-1 text-center ${
                active ? "text-violet-700 font-bold" : "text-gray-500"
              }`}
              numberOfLines={1}
            >
              {s.title}
            </Text>
            {i < STEPS.length - 1 ? null : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <View className="flex-1 bg-white">
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View
        style={{ paddingTop: Math.max(insets.top, 12) + (Platform.OS === "android" ? 8 : 4) }}
        className="px-3 pb-2 flex-row items-center border-b border-gray-100"
      >
        <TouchableOpacity onPress={onBack} className="p-1 mr-1">
          <ArrowLeftIcon size={24} color="#18181B" strokeWidth={2} />
        </TouchableOpacity>
        <Text className="text-[15px] font-black text-gray-900 flex-1" numberOfLines={1}>
          สร้างแพลนเอง
        </Text>
        <Text className="text-[11.5px] text-gray-400 font-semibold">
          ขั้นที่ {step}/4
        </Text>
      </View>

      {renderStepper()}

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── ขั้นที่ 1: จุดเริ่มต้น ─────────────────────────────── */}
        {step === 1 ? (
          <View>
            <Text className="text-[13px] font-bold text-gray-900 mb-1">
              เริ่มจากที่ไหนดี
            </Text>
            <Text className="text-[12px] text-gray-500 mb-3 leading-5">
              เลือกจุดเริ่มต้นจากที่ที่บันทึกไว้ — เส้นทางจะเริ่มจากตรงนี้เสมอ
            </Text>

            <TouchableOpacity
              onPress={() => setOriginModal(true)}
              activeOpacity={0.85}
              className="flex-row items-center bg-violet-50 border border-violet-200 rounded-2xl px-4 py-3.5"
            >
              <MapPinIcon size={20} color="#7C3AED" />
              <Text className="text-violet-700 font-bold text-[14px] ml-2 flex-1">
                เลือกจุดเริ่มต้น (จากที่บันทึกไว้)
              </Text>
            </TouchableOpacity>

            {origin ? (
              <View className="mt-3 bg-white border border-gray-200 rounded-2xl p-4">
                <View className="flex-row items-center">
                  <MapPinIcon size={16} color="#2D6A4F" />
                  <Text className="text-[14px] font-bold text-gray-900 ml-1.5 flex-1">
                    {origin.label}
                  </Text>
                  {originResolving ? (
                    <View className="bg-gray-100 rounded-full px-2 py-0.5 flex-row items-center">
                      <ActivityIndicator size="small" color="#6B7280" />
                      <Text className="text-gray-600 text-[10.5px] font-bold ml-1">
                        กำลังหาพิกัด
                      </Text>
                    </View>
                  ) : originCoords ? (
                    <View className="bg-emerald-50 rounded-full px-2 py-0.5">
                      <Text className="text-emerald-700 text-[10.5px] font-bold">มีพิกัด</Text>
                    </View>
                  ) : (
                    <View className="bg-amber-50 rounded-full px-2 py-0.5">
                      <Text className="text-amber-700 text-[10.5px] font-bold">ไม่มีพิกัด</Text>
                    </View>
                  )}
                </View>
                {origin.address ? (
                  <Text className="text-[12px] text-gray-500 mt-1" numberOfLines={2}>
                    {origin.address}
                  </Text>
                ) : null}
                {origin && !originCoords && !originResolving ? (
                  <Text className="text-[11.5px] text-amber-700 mt-1.5 leading-4">
                    ไปต่อได้เลย แต่เส้นทางจะเป็นค่าประมาณ — ใส่ลิงก์ Google Maps
                    ด้านล่างถ้าอยากให้เส้นทางแม่นขึ้น
                  </Text>
                ) : null}
              </View>
            ) : null}

            {!originCoords ? (
              <View className="mt-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <View className="flex-row items-center mb-2">
                  <ExclamationTriangleIcon size={16} color="#B45309" />
                  <Text className="text-amber-800 text-[12.5px] font-bold ml-1.5">
                    อยากให้เส้นทางแม่น — ใส่ลิงก์ Google Maps ของจุดเริ่มต้น
                  </Text>
                </View>
                <TextInput
                  value={originLink}
                  onChangeText={setOriginLink}
                  placeholder="วางลิงก์ Google Maps ของจุดเริ่มต้น"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="none"
                  className="bg-white border border-amber-200 rounded-xl px-3 py-2.5 text-[13px] text-gray-900"
                />
                <TouchableOpacity
                  onPress={resolveOriginLink}
                  disabled={originResolving}
                  activeOpacity={0.85}
                  className="mt-2 flex-row items-center justify-center bg-amber-600 rounded-xl py-2.5"
                >
                  {originResolving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text className="text-white text-[13px] font-bold">หาพิกัดให้</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ── ขั้นที่ 2: สถานที่ (หน้าเดียว) ───────────────────── */}
        {step === 2 ? (
          <View>
            {/* ── โฟลเดอร์ (ถ้ามี) — อยู่บนสุด ───────────────── */}
            {foldersLoading ? (
              <ActivityIndicator color="#7C3AED" style={{ marginVertical: 12 }} />
            ) : folders.length > 0 ? (
              <View>
                <View className="flex-row items-center mb-2">
                  <FolderIcon size={14} color="#6B7280" />
                  <Text className="text-[12.5px] font-bold text-gray-900 ml-1.5">
                    เลือกโฟลเดอร์ที่มีสถานที่ที่อยากไป
                  </Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 8 }}
                >
                  {folders.map((f) => {
                    const active = folderId === f.id;
                    return (
                      <TouchableOpacity
                        key={f.id}
                        onPress={() => loadFolder(f.id)}
                        activeOpacity={0.8}
                        className={`mr-2 px-3.5 py-2.5 rounded-2xl border ${
                          active
                            ? "bg-violet-600 border-violet-600"
                            : "bg-white border-gray-200"
                        }`}
                      >
                        <Text
                          className={`text-[13px] font-bold ${
                            active ? "text-white" : "text-gray-800"
                          }`}
                          numberOfLines={1}
                        >
                          {f.name}
                        </Text>
                        <Text
                          className={`text-[11px] mt-0.5 ${
                            active ? "text-violet-100" : "text-gray-400"
                          }`}
                        >
                          {f.clip_count ?? 0} คลิป
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {folderLoading ? (
                  <ActivityIndicator color="#7C3AED" style={{ marginVertical: 12 }} />
                ) : folderPlaces.length ? (
                  <View className="mt-2 bg-white border border-gray-200 rounded-2xl overflow-hidden">
                    {folderPlaces.map((p) => {
                      const key = `f-${p.key}`;
                      const chosen = places.some((x) => x.key === key);
                      return (
                        <TouchableOpacity
                          key={p.key}
                          onPress={() => toggleFolderPlace(p)}
                          activeOpacity={0.8}
                          className="flex-row items-center px-3.5 py-3 border-b border-gray-100"
                        >
                          <View
                            className={`w-5 h-5 rounded-full items-center justify-center mr-2.5 ${
                              chosen ? "bg-violet-600" : "border border-gray-300"
                            }`}
                          >
                            {chosen ? <CheckIcon size={12} color="#FFFFFF" /> : null}
                          </View>
                          <View className="flex-1">
                            <Text className="text-[13px] font-semibold text-gray-900">
                              {p.name}
                            </Text>
                            <Text className="text-[11px] text-gray-500" numberOfLines={1}>
                              {[
                                p.communityName,
                                p.address,
                                p.latitude != null ? "มีพิกัด" : "ยังไม่มีพิกัด",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : folderId ? (
                  <View className="mt-2 bg-gray-50 border border-gray-200 rounded-2xl p-4">
                    <Text className="text-[12.5px] text-gray-500">
                      โฟลเดอร์นี้ยังไม่มีสถานที่ที่ยืนยันพิกัด
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* ── ปุ่มเพิ่มสถานที่ด้วย AI (อยู่ใต้โฟลเดอร์) ───── */}
            <TouchableOpacity
              onPress={() => setAiSheetOpen(true)}
              activeOpacity={0.85}
              className="mt-4 mb-4 flex-row items-center justify-center bg-violet-600 rounded-2xl py-3"
            >
              <SparklesIcon size={18} color="#FFFFFF" />
              <Text className="text-white text-[13.5px] font-bold ml-1.5">
                เพิ่มสถานที่ด้วย AI
              </Text>
            </TouchableOpacity>

            {/* ── ค้นหาสถานที่ / ใส่เอง (อยู่ใต้โฟลเดอร์) ───────── */}
            {formReady ? (
              <View>
                <Text className="text-[12.5px] font-bold text-gray-900 mb-2">
                  ค้นหาชื่อสถานที่ที่เคยบันทึกไว้ในแอป
                </Text>
                <View className="flex-row items-center">
                  <TextInput
                    value={manualQuery}
                    onChangeText={setManualQuery}
                    onSubmitEditing={searchLocal}
                    placeholder="พิมพ์ชื่อสถานที่"
                    placeholderTextColor="#9CA3AF"
                    returnKeyType="search"
                    className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[13.5px] text-gray-900"
                  />
                  <TouchableOpacity
                    onPress={searchLocal}
                    disabled={searching}
                    activeOpacity={0.8}
                    className="ml-2 bg-gray-900 rounded-xl px-3.5 py-2.5"
                  >
                    {searching ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <MagnifyingGlassIcon size={18} color="#FFFFFF" />
                    )}
                  </TouchableOpacity>
                </View>

                {localHits.length ? (
                  <View className="mt-2 bg-white border border-gray-200 rounded-2xl overflow-hidden">
                    {localHits.map((h) => (
                      <TouchableOpacity
                        key={h.id}
                        onPress={() => addLocalHit(h)}
                        activeOpacity={0.8}
                        className="flex-row items-center px-3.5 py-3 border-b border-gray-100"
                      >
                        <View className="flex-1">
                          <Text className="text-[13px] font-semibold text-gray-900">
                            {h.name}
                          </Text>
                          <Text className="text-[11px] text-gray-500" numberOfLines={1}>
                            {[
                              h.community,
                              h.district,
                              h.province,
                              h.latitude != null ? "มีพิกัด" : "ยังไม่มีพิกัด",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        </View>
                        <PlusIcon size={18} color="#7C3AED" />
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}

                <View className="mt-4 bg-white border border-gray-200 rounded-2xl p-4">
                  <View className="flex-row items-center mb-2">
                    <PencilSquareIcon size={14} color="#6B7280" />
                    <Text className="text-[12.5px] font-bold text-gray-900 ml-1.5">
                      หรือใส่สถานที่เอง
                    </Text>
                  </View>
                  <TextInput
                    value={manualName}
                    onChangeText={setManualName}
                    placeholder="ชื่อสถานที่"
                    placeholderTextColor="#9CA3AF"
                    className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[13.5px] text-gray-900 mb-2"
                  />
                  <TextInput
                    value={manualLink}
                    onChangeText={setManualLink}
                    placeholder="ลิงก์ Google Maps (ถ้ามี)"
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="none"
                    className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[13.5px] text-gray-900 mb-2"
                  />
                  <TouchableOpacity
                    onPress={addManualPlace}
                    activeOpacity={0.85}
                    className="flex-row items-center justify-center bg-violet-600 rounded-xl py-2.5"
                  >
                    <PlusIcon size={16} color="#FFFFFF" />
                    <Text className="text-white text-[13px] font-bold ml-1">
                      เพิ่มสถานที่
                    </Text>
                  </TouchableOpacity>
                  <Text className="text-[11px] text-gray-400 mt-1.5">
                    เพิ่มเข้ารายการทันที — ระบบจะหาพิกัดให้ในเบื้องหลัง
                  </Text>
                </View>
              </View>
            ) : (
              // ช่องกรอกยังไม่ mount — รอ commit ถัดไป (กัน iOS ค้างตอนเข้าขั้นที่ 2)
              <View className="h-[220px]" />
            )}

            {/* ── รายการที่เลือก ─────────────────────────────────── */}
            <View className="mt-5">
              <View className="flex-row items-center mb-2">
                <Text className="text-[13px] font-bold text-gray-900 flex-1">
                  สถานที่ที่เลือก ({places.length})
                </Text>
                {places.length > 1 ? (
                  <TouchableOpacity onPress={autoOrder} activeOpacity={0.8}>
                    <Text className="text-[12px] font-bold text-violet-700">
                      เรียงใกล้กันที่สุด
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {places.length === 0 ? (
                <View className="bg-gray-50 border border-dashed border-gray-300 rounded-2xl p-4">
                  <Text className="text-[12.5px] text-gray-500 text-center">
                    ยังไม่ได้เลือกสถานที่ — เลือกจากโฟลเดอร์ หรือใส่เอง
                  </Text>
                </View>
              ) : (
                <View className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                  {places.map((p, i) => (
                    <View
                      key={p.key}
                      className="flex-row items-center px-3 py-2.5 border-b border-gray-100"
                    >
                      <View className="w-6 h-6 rounded-full bg-violet-100 items-center justify-center">
                        <Text className="text-[11px] font-black text-violet-700">
                          {i + 1}
                        </Text>
                      </View>
                      <View className="flex-1 ml-2 mr-1">
                        <Text className="text-[13px] font-semibold text-gray-900" numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text className="text-[10.5px] text-gray-400" numberOfLines={1}>
                          {p.resolving
                            ? "กำลังหาพิกัด…"
                            : p.coords
                            ? "มีพิกัด"
                            : "ยังไม่มีพิกัด"}
                          {p.source === "clip" ? " · จากคลิปในโฟลเดอร์" : ""}
                          {p.source === "manual" ? " · ใส่เอง" : ""}
                          {p.province ? ` · ${p.province}` : ""}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => movePlace(i, -1)}
                        disabled={i === 0}
                        hitSlop={6}
                        className="p-1"
                      >
                        <ChevronUpIcon
                          size={17}
                          color={i === 0 ? "#D1D5DB" : "#6B7280"}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => movePlace(i, 1)}
                        disabled={i === places.length - 1}
                        hitSlop={6}
                        className="p-1"
                      >
                        <ChevronDownIcon
                          size={17}
                          color={i === places.length - 1 ? "#D1D5DB" : "#6B7280"}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => removePlace(p.key)}
                        hitSlop={6}
                        className="p-1 ml-1"
                      >
                        <TrashIcon size={16} color="#DC2626" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        ) : null}

        {/* ── ขั้นที่ 3: ลำดับ/เวลา/งบ ──────────────────────────── */}
        {step === 3 ? (
          <View>
            <Text className="text-[13px] font-bold text-gray-900 mb-1">
              ออกเดินทางกี่โมง
            </Text>
            <Text className="text-[12px] text-gray-500 mb-3 leading-5">
              เวลาเริ่มต้นของวัน — แอปจะคำนวณเวลามาถึงแต่ละจุดให้อัตโนมัติ
            </Text>

            <TouchableOpacity
              onPress={() => setTimeSheet(true)}
              activeOpacity={0.85}
              className="flex-row items-center justify-between bg-white border border-gray-200 rounded-2xl px-4 py-3.5"
            >
              <View className="flex-row items-center">
                <ClockIcon size={18} color="#7C3AED" />
                <Text className="text-[14px] font-bold text-gray-900 ml-2">
                  เวลาเริ่มต้นของวัน
                </Text>
              </View>
              <Text className="text-[16px] font-black text-violet-700">{startTime}</Text>
            </TouchableOpacity>

            <View className="mt-4 bg-white border border-gray-200 rounded-2xl p-4">
              <Text className="text-[12.5px] font-bold text-gray-900 mb-1">
                เวลาที่อยู่ที่แต่ละจุด
              </Text>
              <Text className="text-[11.5px] text-gray-500 leading-5">
                ค่าเริ่มต้น 1 ชั่วโมงต่อจุด — ปรับเวลาที่จะอยู่จริงได้ในหน้าแพลนหลังสร้างเสร็จ
              </Text>
            </View>

            <Text className="text-[13px] font-bold text-gray-900 mt-5 mb-2">
              สไตล์ทริป
            </Text>
            <View className="flex-row flex-wrap">
              {TRAVEL_STYLES.map((s) => {
                const active = style === s.key;
                return (
                  <TouchableOpacity
                    key={s.key}
                    onPress={() => setStyle(s.key)}
                    activeOpacity={0.8}
                    className={`mr-2 mb-2 px-3 py-2 rounded-full border ${
                      active
                        ? "bg-violet-600 border-violet-600"
                        : "bg-white border-gray-200"
                    }`}
                  >
                    <Text
                      className={`text-[12.5px] font-bold ${
                        active ? "text-white" : "text-gray-600"
                      }`}
                    >
                      {s.emoji} {s.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text className="text-[13px] font-bold text-gray-900 mt-4 mb-2">
              ชื่อแพลน (ถ้าไม่ใส่จะตั้งให้อัตโนมัติ)
            </Text>
            <TextInput
              value={planName}
              onChangeText={setPlanName}
              placeholder={`ทริป ${places[0]?.name ?? "ของฉัน"}`}
              placeholderTextColor="#9CA3AF"
              className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[13.5px] text-gray-900 mb-4"
            />

            <Text className="text-[13px] font-bold text-gray-900 mb-2">
              งบต่อคน (ถ้ายังไม่รู้ เว้นว่างไว้ได้)
            </Text>
            <TextInput
              value={budget}
              onChangeText={setBudget}
              placeholder="เช่น 1500"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
              className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-[13.5px] text-gray-900"
            />
          </View>
        ) : null}

        {/* ── ขั้นที่ 4: สรุป ───────────────────────────────────── */}
        {step === 4 ? (
          <View>
            <Text className="text-[13px] font-bold text-gray-900 mb-2">
              สรุปแผน
            </Text>

            <View className="bg-white border border-gray-200 rounded-2xl p-4">
              <View className="flex-row items-center">
                <MapPinIcon size={15} color="#2D6A4F" />
                <Text className="text-[13px] font-bold text-gray-900 ml-1.5 flex-1">
                  เริ่ม: {origin?.label ?? "-"}
                </Text>
              </View>
              <View className="flex-row items-center mt-2">
                <ClockIcon size={15} color="#6B7280" />
                <Text className="text-[13px] text-gray-700 ml-1.5">
                  ออกเดินทาง {startTime} · {places.length} จุด
                </Text>
              </View>

              <View className="h-px bg-gray-100 my-3" />

              {routeLoading ? (
                <View className="flex-row items-center py-2">
                  <ActivityIndicator size="small" color="#7C3AED" />
                  <Text className="text-[12.5px] text-gray-500 ml-2">
                    กำลังคำนวณเส้นทาง…
                  </Text>
                </View>
              ) : route ? (
                <>
                  <View className="flex-row items-center mb-1.5">
                    <TruckIcon size={15} color="#2563EB" />
                    <Text className="text-[13px] font-bold text-gray-900 ml-1.5">
                      {kmText(route.totalKm)} · เดินทาง {minutesText(route.totalDriveMinutes)}
                    </Text>
                  </View>
                  <View className="flex-row items-center">
                    <SparklesIcon size={13} color="#7C3AED" />
                    <Text className="text-[11.5px] text-gray-500 ml-1.5">
                      {route.routeSource === "osrm"
                        ? "เส้นทางจริงจาก OSRM (ยังไม่รวมสภาพจราจร)"
                        : "ค่าประมาณ (คำนวณเอง — ต่ออินเทอร์เน็ตไม่ได้)"}
                    </Text>
                  </View>
                </>
              ) : null}
            </View>

            <View className="mt-3 bg-white border border-gray-200 rounded-2xl overflow-hidden">
              {/* จุดเริ่มต้นที่บันทึกไว้ — แถวแรกของแพลน */}
              <View className="flex-row items-center px-3.5 py-2.5 border-b border-gray-100 bg-emerald-50/60">
                <View className="w-6 h-6 rounded-full bg-emerald-100 items-center justify-center">
                  <MapPinIcon size={12} color="#2D6A4F" />
                </View>
                <View className="flex-1 ml-2">
                  <Text className="text-[11px] font-bold text-emerald-700">จุดเริ่มต้น</Text>
                  <Text className="text-[13px] font-semibold text-gray-900" numberOfLines={1}>
                    {origin?.label ?? "-"}
                  </Text>
                </View>
              </View>

              {places.map((p, i) => (
                <View
                  key={p.key}
                  className="flex-row items-center px-3.5 py-2.5 border-b border-gray-100"
                >
                  <View className="w-6 h-6 rounded-full bg-violet-100 items-center justify-center">
                    <Text className="text-[11px] font-black text-violet-700">{i + 1}</Text>
                  </View>
                  <Text className="text-[13px] font-semibold text-gray-900 ml-2 flex-1" numberOfLines={1}>
                    {p.name}
                  </Text>
                </View>
              ))}
              <TouchableOpacity
                onPress={() => setEndModal(true)}
                activeOpacity={0.85}
                className="flex-row items-center px-3.5 py-2.5"
              >
                <View className="w-6 h-6 rounded-full bg-gray-200 items-center justify-center">
                  <Text className="text-[11px] font-black text-gray-600">↩</Text>
                </View>
                <View className="flex-1 ml-2">
                  <Text className="text-[11px] font-bold text-gray-500">จุดกลับ</Text>
                  <Text className="text-[13px] font-semibold text-gray-600" numberOfLines={1}>
                    กลับ {(customEnd ?? origin)?.label ?? "จุดเริ่มต้น"}
                    {endResolving ? " · กำลังหาพิกัด…" : ""}
                  </Text>
                </View>
                {customEnd ? (
                  <TouchableOpacity
                    onPress={() => setCustomEnd(null)}
                    activeOpacity={0.8}
                    hitSlop={6}
                    className="px-2 py-1"
                  >
                    <Text className="text-[11.5px] font-bold text-violet-700">
                      ↺ กลับจุดเริ่มต้น
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <Text className="text-[11.5px] font-bold text-violet-700">
                    เปลี่ยน
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={calcRoute}
              activeOpacity={0.8}
              className="mt-3 flex-row items-center justify-center py-2"
            >
              <Text className="text-[12.5px] font-bold text-violet-700">
                คำนวณเส้นทางใหม่
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <View
        className="px-5 pt-3 border-t border-gray-100 bg-white"
        style={{ paddingBottom: Math.max(insets.bottom, 14) }}
      >
        <View className="flex-row">
          {step > 1 ? (
            <TouchableOpacity
              onPress={() => goStep((step - 1) as Step)}
              activeOpacity={0.85}
              className="flex-1 py-3.5 rounded-2xl border border-gray-200 items-center justify-center mr-2"
            >
              <Text className="text-[14px] font-bold text-gray-600">ย้อนกลับ</Text>
            </TouchableOpacity>
          ) : null}

          {step < 4 ? (
            <TouchableOpacity
              onPress={() => goStep((step + 1) as Step)}
              disabled={!canNext}
              activeOpacity={0.85}
              className={`flex-1 py-3.5 rounded-2xl items-center justify-center ${
                canNext ? "bg-violet-600" : "bg-gray-300"
              }`}
            >
              <Text className="text-white font-bold text-[14px]">ถัดไป</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={createPlan}
              disabled={creating}
              activeOpacity={0.85}
              className={`flex-1 py-3.5 rounded-2xl items-center justify-center ${
                creating ? "bg-gray-300" : "bg-violet-600"
              }`}
            >
              {creating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text className="text-white font-bold text-[14px]">สร้างแพลน</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* บอกเหตุผลที่ปุ่ม “ถัดไป” ยังกดไม่ได้ — ไม่งั้นผู้ใช้จะคิดว่าแอปค้าง */}
        {step < 4 && !canNext ? (
          <Text className="text-[11.5px] text-gray-500 text-center mt-2">
            {step === 1
              ? "เลือกจุดเริ่มต้นก่อนถึงจะไปต่อได้"
              : "เพิ่มสถานที่อย่างน้อย 1 แห่งก่อนถึงจะไปต่อได้"}
          </Text>
        ) : null}
      </View>

      {/* ── Modals ─────────────────────────────────────────────── */}
      <OriginSelectorModal
        visible={originModal}
        onClose={() => setOriginModal(false)}
        onSelectOrigin={(o) => {
          setOriginModal(false);
          void pickOrigin(o);
        }}
        title="เลือกจุดเริ่มต้น"
        subtitle="เลือกจากที่ที่บันทึกไว้"
        defaultLabel="บ้าน"
      />

      {/* เลือก "จุดกลับ" (ค่าเริ่มต้น = กลับจุดเริ่มต้น) */}
      <OriginSelectorModal
        visible={endModal}
        onClose={() => setEndModal(false)}
        onSelectOrigin={(o) => {
          setEndModal(false);
          void pickEnd(o);
        }}
        title="เลือกจุดกลับ"
        subtitle="ปลายทางของทริป (ถ้าไม่เลือก = กลับจุดเริ่มต้น)"
        defaultLabel="จุดกลับ"
      />

      <TripTimeSheet
        visible={timeSheet}
        value={startTime}
        resetKey={timeSheet ? 1 : 0}
        onCancel={() => setTimeSheet(false)}
        onConfirm={(t) => {
          setStartTime(t);
          setTimeSheet(false);
        }}
      />

      {/* ชีต "เพิ่มสถานที่ด้วย AI" — ใกล้เคียงกับที่เลือกในขั้นที่ 2 / สุ่มแรนด์ */}
      <TripAiPlaceSheet
        visible={aiSheetOpen}
        onClose={() => setAiSheetOpen(false)}
        anchors={aiAnchors}
        style={style}
        onAdd={handleAiAdd}
      />
    </View>
  );
}
