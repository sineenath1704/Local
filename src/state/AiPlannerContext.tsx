import React, { createContext, useContext, useMemo, useState, useCallback } from "react";
import {
  AiChatThread,
  AiChatMessage,
  Trip,
  TripStatus,
} from "../data/tripsData";

/**
 * AiPlannerContext — chat threads + trips produced by the AI planner.
 * Threads split into: folder-scoped (one per folder) and general.
 */
interface AiPlannerState {
  threads: AiChatThread[];
  trips: Trip[];

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
}

const AiPlannerContext = createContext<AiPlannerState | null>(null);

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${seq++}`;

export function AiPlannerProvider({ children }: { children: React.ReactNode }) {
  const [threads, setThreads] = useState<AiChatThread[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);

  const getThread = useCallback((id: string) => threads.find((t) => t.id === id), [threads]);

  const startGeneralThread = useCallback(() => {
    const id = uid("thread");
    setThreads((prev) => [
      { id, title: "แชทใหม่", messages: [], createdAt: Date.now() },
      ...prev,
    ]);
    return id;
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

  const value = useMemo<AiPlannerState>(
    () => ({
      threads,
      trips,
      getThread,
      startGeneralThread,
      startFolderThread,
      appendMessage,
      addTrip,
      updateTrip,
      setTripStatus,
      tripsByStatus,
    }),
    [
      threads,
      trips,
      getThread,
      startGeneralThread,
      startFolderThread,
      appendMessage,
      addTrip,
      updateTrip,
      setTripStatus,
      tripsByStatus,
    ]
  );

  return <AiPlannerContext.Provider value={value}>{children}</AiPlannerContext.Provider>;
}

export function useAiPlanner(): AiPlannerState {
  const ctx = useContext(AiPlannerContext);
  if (!ctx) throw new Error("useAiPlanner must be used within an AiPlannerProvider");
  return ctx;
}
