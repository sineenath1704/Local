import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  AiChatThread,
  AiChatMessage,
  ClipContext,
  Trip,
  TripStatus,
  TRAVEL_STYLES,
} from "../data/tripsData";
import type { VideoPost } from "../data/homeFeedData";
import { fetchMyTripPlans, updateMyTripPlan } from "../services/tripPlanService";

/**
 * สิ่งที่แนบมากับข้อความแรกของแชทที่เปิดจากคลิป
 * -------------------------------------------------------------
 * · clipContext = ข้อมูลสถานที่จากสรุปของคลิป → backend แทรกใน system prompt
 * · video       = คลิปเอง → แสดงเป็นการ์ดวิดีโอในแชท (แตะเปิดดูเต็มจอ)
 */
export interface ChatSeedExtras {
  clipContext?: ClipContext | null;
  video?: VideoPost | null;
  /**
   * แผนทริปที่กำลังจะให้เอไaiช่วยแก้ (จากหน้าแผนทริป)
   * → ส่งเป็นบล็อกข้อมูลใน system prompt ให้เอไaiอ้างอิงแผนเดิมได้
   */
  planContext?: unknown;
}

/**
 * AiPlannerContext — chat threads + trips produced by the AI planner.
 * Threads split into: folder-scoped (one per folder) and general.
 */
interface AiPlannerState {
  threads: AiChatThread[];
  trips: Trip[];

  /**
   * A one-shot "seed" used to jump into the AI chat from elsewhere (e.g. the
   * comment sheet's AI-summary tab → "คุยต่อกับ AI"). Holds the thread that was
   * just created + the first user message to send. AiHubScreen consumes it.
   */
  pendingChatSeed: ({ threadId: string; message: string } & ChatSeedExtras) | null;
  /** Create a fresh general thread seeded with `message`, and request opening it. */
  openChatWithSeed: (message: string, extras?: ChatSeedExtras) => void;
  /** Clear the pending seed once AiHubScreen has opened + sent it. */
  consumePendingChatSeed: () => void;

  getThread: (id: string) => AiChatThread | undefined;
  /** Start (or reuse) a general chat thread. Returns thread id. */
  startGeneralThread: () => string;
  /** Start (or reuse) the thread tied to a folder. Returns thread id. */
  startFolderThread: (folderId: string, folderName: string) => string;
  appendMessage: (threadId: string, msg: Omit<AiChatMessage, "id" | "at">) => void;
  /**
   * แก้ไขข้อความเดิมในเธรด (ไม่ใช่เพิ่มข้อความใหม่)
   * → ใช้ตอนแนบ/แก้แผนทริปที่วาดไว้กับข้อความนั้น
   */
  updateMessage: (
    threadId: string,
    messageId: string,
    patch: Partial<AiChatMessage>
  ) => void;

  addTrip: (trip: Trip) => void;
  updateTrip: (tripId: string, patch: Partial<Trip>) => void;
  setTripStatus: (tripId: string, status: TripStatus) => void;
  tripsByStatus: (status: TripStatus) => Trip[];
  getTripByPlanId: (planId: string) => Trip | undefined;
  createOrUpdateTripFromPlan: (tripData: Partial<Trip> & { title: string; destinations: string[] }) => Trip;
}

const AiPlannerContext = createContext<AiPlannerState | null>(null);

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${seq++}`;

export function AiPlannerProvider({ children }: { children: React.ReactNode }) {
  const [threads, setThreads] = useState<AiChatThread[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [pendingChatSeed, setPendingChatSeed] = useState<
    ({ threadId: string; message: string } & ChatSeedExtras) | null
  >(null);

  const getThread = useCallback((id: string) => threads.find((t) => t.id === id), [threads]);

  /**
   * ทริปณปัจจุบัน (สำหรับตัวจับเวลาหน่วงการบันทึก)
   * → เก็บใน ref เพื่อให้ callback ไม่ต้องผูกกับ state (ไม่สร้าง callback ใหม่ทุกครั้งที่แก้)
   */
  const tripsRef = useRef<Trip[]>(trips);
  useEffect(() => {
    tripsRef.current = trips;
  }, [trips]);

  /** ตัวจับเวลาหน่วงการเขียนลง Supabase (key = planId) */
  const persistTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    // เคลียร์ตัวจับเวลาตอนแอปปิด
    const timers = persistTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  /**
   * โหลดแผนทริปที่บันทึกไว้ในระบบ (`trip_plans`) ตอนเปิดแอป
   * → แผนไม่หายเมื่อปิดแอป และรู้ว่ามาจากโฟลเดอร์ไหน
   * (ถ้าโหลดไม่ได้ เช่น ยังไม่มี migration → แอปยังทำงานต่อได้ปกติ)
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await fetchMyTripPlans();
      if (cancelled || stored.length === 0) return;
      setTrips((prev) => {
        // กุญแจจับคู่ = planId (ถ้ามี) ไม่งั้น id
        // → แผนที่เพิ่งสร้างในเครื่อง (ยังไม่ sync) ต้องไม่ถูกแถวใน DB ทับ
        const byKey = new Map<string, Trip>();
        for (const t of stored) byKey.set(t.planId || t.id, t);
        for (const t of prev) byKey.set(t.planId || t.id, t);
        return [...byKey.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startGeneralThread = useCallback(() => {
    const id = uid("thread");
    setThreads((prev) => [
      { id, title: "แชทใหม่", messages: [], createdAt: Date.now() },
      ...prev,
    ]);
    return id;
  }, []);

  const openChatWithSeed = useCallback((message: string, extras?: ChatSeedExtras) => {
    const text = message.trim();
    if (!text) return;
    const id = uid("thread");
    setThreads((prev) => [
      {
        id,
        title: "คุยต่อจากสรุป AI",
        messages: [],
        createdAt: Date.now(),
        // เก็บบริบทคลิปไว้กับเธรด → ทุกข้อความในแชทนี้ยึดข้อมูลชุดเดียวกัน
        clipContext: extras?.clipContext ?? null,
        video: extras?.video ?? null,
      },
      ...prev,
    ]);
    setPendingChatSeed({
      threadId: id,
      message: text,
      clipContext: extras?.clipContext ?? null,
      video: extras?.video ?? null,
      planContext: extras?.planContext ?? null,
    });
  }, []);

  const consumePendingChatSeed = useCallback(() => {
    setPendingChatSeed(null);
  }, []);

  const startFolderThread = useCallback(
    (folderId: string, folderName: string) => {
      const existing = threads.find((t) => t.folderId === folderId);
      if (existing) return existing.id;
      const id = uid("thread");
      setThreads((prev) => [
        { id, title: folderName, folderId, messages: [], createdAt: Date.now() },
        ...prev,
      ]);
      return id;
    },
    [threads]
  );

  const appendMessage = useCallback(
    (threadId: string, msg: Omit<AiChatMessage, "id" | "at">) => {
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? { ...t, messages: [...t.messages, { ...msg, id: uid("m"), at: Date.now() }] }
            : t
        )
      );
    },
    []
  );

  const updateMessage = useCallback(
    (threadId: string, messageId: string, patch: Partial<AiChatMessage>) => {
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? {
                ...t,
                messages: t.messages.map((m) =>
                  m.id === messageId ? { ...m, ...patch } : m
                ),
              }
            : t
        )
      );
    },
    []
  );

  const addTrip = useCallback((trip: Trip) => {
    setTrips((prev) => [trip, ...prev]);
  }, []);

  /**
   * แก้ไขทริป → อัปเดตในเครื่อง + บันทึกกลับ Supabase (ถ้าเป็นแผนที่มี planId)
   * -----------------------------------------------------------------
   * เดิมแก้แล้วหายเมื่อปิดแอป เพราะเก็บแค่ใน state
   * → ตอนนี้เขียนกลับ `trip_plans` (RLS อนุญาตให้แก้แถวของตัวเอง)
   */
  const updateTrip = useCallback(
    (tripId: string, patch: Partial<Trip>) => {
      setTrips((prev) => prev.map((t) => (t.id === tripId ? { ...t, ...patch } : t)));

      const planId = tripsRef.current.find((t) => t.id === tripId)?.planId;
      if (!planId) return;

      // หน่วงการเขียนลง DB — พิมพ์ชื่อจุดทีละตัวอักษรไม่ควรยิง Supabase ทุกตัว
      const existing = persistTimers.current[planId];
      if (existing) clearTimeout(existing);
      persistTimers.current[planId] = setTimeout(() => {
        delete persistTimers.current[planId];
        const latest = tripsRef.current.find((t) => t.id === tripId);
        if (!latest) return;
        void updateMyTripPlan(planId, {
          itinerary: latest.itinerary,
          appStatus: latest.status,
          planName: latest.title,
          startLocation: latest.startPoint,
          returnLocation: latest.endPoint ?? null,
          budgetLimit: latest.budgetPerPerson,
          travelStyle:
            TRAVEL_STYLES.find((s) => s.key === latest.style)?.label ?? latest.style,
        });
      }, 800);
    },
    []
  );

  const setTripStatus = useCallback(
    (tripId: string, status: TripStatus) => {
      const current = tripsRef.current.find((t) => t.id === tripId);
      setTrips((prev) => prev.map((t) => (t.id === tripId ? { ...t, status } : t)));
      if (!current?.planId) return;
      // สถานะของแอปเก็บใน `itinerary_data.__meta.appStatus` (คอลัมน์ status ของ DB เป็นคนละชุด)
      void updateMyTripPlan(current.planId, { appStatus: status });
    },
    []
  );

  const tripsByStatus = useCallback(
    (status: TripStatus) => trips.filter((t) => t.status === status),
    [trips]
  );

  const getTripByPlanId = useCallback(
    (planId: string) => trips.find((t) => t.planId === planId),
    [trips]
  );

  const createOrUpdateTripFromPlan = useCallback(
    (data: Partial<Trip> & { title: string; destinations: string[] }): Trip => {
      const existing = data.planId ? trips.find((t) => t.planId === data.planId) : undefined;
      if (existing) {
        const updated: Trip = {
          ...existing,
          ...data,
          updatedAt: Date.now(),
        };
        setTrips((prev) => prev.map((t) => (t.id === existing.id ? updated : t)));
        return updated;
      }

      const newTrip: Trip = {
        id: data.id || uid("trip"),
        planId: data.planId || uid("plan"),
        title: data.title,
        summary: data.summary || "แผนการเดินทางจาก AI ผู้ช่วยจัดทริป",
        status: data.status || "draft",
        startPoint: data.startPoint || "จุดเริ่มต้น",
        startPointUrl: data.startPointUrl,
        startPointCoords: data.startPointCoords,
        startTime: data.startTime || "08:00",
        destinations: data.destinations,
        days: data.days || 1,
        nights: data.nights || 0,
        budgetPerPerson: data.budgetPerPerson || 1500,
        style: data.style || "nature",
        itinerary: data.itinerary || [
          {
            day: 1,
            stops: data.destinations.map((d) => ({
              name: d,
              activity: "ท่องเที่ยวและเรียนรู้วิถีชุมชน",
              stayHours: 2,
              driveToNextMins: 30,
            })),
          },
        ],
        budget: data.budget || {
          lodging: 0,
          fuel: 300,
          food: 400,
          total: 700,
          perPerson: 700,
          withinBudget: true,
        },
        sourceFolderId: data.sourceFolderId,
        // สถานที่ของโฟลเดอร์พร้อมที่มา (ยืนยันแล้ว / ยังไม่ยืนยัน)
        folderPlaces: data.folderPlaces,
        // ── ข้อมูลของแพลนที่คำนวณจริง ──
        // (ต้องเก็บตั้งแต่ตอน "สร้างใหม่" ไม่ใช่ตอน "แก้ของเดิม"
        //  ไม่งั้นแผนที่สร้างครั้งแรกจะไม่มีจุดสิ้นสุด/เส้นทาง/ราคาน้ำมัน)
        travelers: data.travelers,
        returnMode: data.returnMode,
        endPoint: data.endPoint,
        endPointCoords: data.endPointCoords,
        vehicle: data.vehicle,
        fuel: data.fuel,
        lodging: data.lodging,
        warnings: data.warnings,
        assumptions: data.assumptions,
        routeSource: data.routeSource,
        routeCredit: data.routeCredit,
        createdAt: Date.now(),
      };

      setTrips((prev) => [newTrip, ...prev]);
      return newTrip;
    },
    [trips]
  );

  const value = useMemo<AiPlannerState>(
    () => ({
      threads,
      trips,
      pendingChatSeed,
      openChatWithSeed,
      consumePendingChatSeed,
      getThread,
      startGeneralThread,
      startFolderThread,
      appendMessage,
      updateMessage,
      addTrip,
      updateTrip,
      setTripStatus,
      tripsByStatus,
      getTripByPlanId,
      createOrUpdateTripFromPlan,
    }),
    [
      threads,
      trips,
      pendingChatSeed,
      openChatWithSeed,
      consumePendingChatSeed,
      getThread,
      startGeneralThread,
      startFolderThread,
      appendMessage,
      updateMessage,
      addTrip,
      updateTrip,
      setTripStatus,
      tripsByStatus,
      getTripByPlanId,
      createOrUpdateTripFromPlan,
    ]
  );

  return <AiPlannerContext.Provider value={value}>{children}</AiPlannerContext.Provider>;
}

export function useAiPlanner(): AiPlannerState {
  const ctx = useContext(AiPlannerContext);
  if (!ctx) throw new Error("useAiPlanner must be used within an AiPlannerProvider");
  return ctx;
}
