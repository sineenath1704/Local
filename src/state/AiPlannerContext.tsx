import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
import {
  AiChatThread,
  AiChatMessage,
  Trip,
  TripStatus,
} from "../data/tripsData";
import { fetchMyTripPlans } from "../services/tripPlanService";

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
  pendingChatSeed: { threadId: string; message: string } | null;
  /** Create a fresh general thread seeded with `message`, and request opening it. */
  openChatWithSeed: (message: string) => void;
  /** Clear the pending seed once AiHubScreen has opened + sent it. */
  consumePendingChatSeed: () => void;

  getThread: (id: string) => AiChatThread | undefined;
  /** Start (or reuse) a general chat thread. Returns thread id. */
  startGeneralThread: () => string;
  /** Start (or reuse) the thread tied to a folder. Returns thread id. */
  startFolderThread: (folderId: string, folderName: string) => string;
  appendMessage: (threadId: string, msg: Omit<AiChatMessage, "id" | "at">) => void;

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
    { threadId: string; message: string } | null
  >(null);

  const getThread = useCallback((id: string) => threads.find((t) => t.id === id), [threads]);

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

  const openChatWithSeed = useCallback((message: string) => {
    const text = message.trim();
    if (!text) return;
    const id = uid("thread");
    setThreads((prev) => [
      { id, title: "คุยต่อจากสรุป AI", messages: [], createdAt: Date.now() },
      ...prev,
    ]);
    setPendingChatSeed({ threadId: id, message: text });
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

  const addTrip = useCallback((trip: Trip) => {
    setTrips((prev) => [trip, ...prev]);
  }, []);

  const updateTrip = useCallback((tripId: string, patch: Partial<Trip>) => {
    setTrips((prev) => prev.map((t) => (t.id === tripId ? { ...t, ...patch } : t)));
  }, []);

  const setTripStatus = useCallback((tripId: string, status: TripStatus) => {
    setTrips((prev) => prev.map((t) => (t.id === tripId ? { ...t, status } : t)));
  }, []);

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
