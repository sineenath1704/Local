import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  FlatList,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeftIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  FolderIcon,
  PaperClipIcon,
  XMarkIcon,
  MapPinIcon,
  CalendarDaysIcon,
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  CheckBadgeIcon,
  QuestionMarkCircleIcon,
} from "react-native-heroicons/outline";
import { useAiPlanner } from "../../state/AiPlannerContext";
import { useInteractions } from "../../state/InteractionContext";
import { useAuth } from "../../state/AuthContext";
import { sendChat } from "../../services/aiChatService";
import { asAiError } from "../../services/aiHttp";
import { getFolderContextForAi } from "../../services/folderService";
import {
  getFolderContext,
  toTripFolderPlaces,
  type FolderContextInfo,
} from "../../services/folderContextService";
import { generateTrip } from "../../services/tripService";
import { AiChatMessage, Trip } from "../../data/tripsData";
import OriginSelectorModal from "../../components/OriginSelectorModal";
import { parseGoogleMapsUrl } from "../../services/savedPlacesService";

interface AiChatScreenProps {
  threadId: string;
  onBack: () => void;
  onPlanTrip?: (folderId?: string) => void;
  onOpenTrip?: (tripId: string) => void;
  /** If set, auto-send this as the first user message once, on mount. */
  initialMessage?: string;
  /** Plan ID tied to this thread (if modifying an existing trip) */
  linkedPlanId?: string;
}

const SUGGESTIONS = [
  "ช่วยวางแผนทริป 3 วันจากคลิปที่เซฟไว้",
  "ที่พักชุมชนงบไม่เกิน 500 บาทมีที่ไหนบ้าง",
  "แนะนำอาหารพื้นถิ่นที่ต้องลอง",
];

/** Quick-prompt chips shown only in host-self mode — the host is asking
 * about their own business, so the prompts are advisory in tone. */
const HOST_SUGGESTIONS = [
  "สรุปธุรกิจของฉันให้หน่อย",
  "วันไหนที่ร้านปิดบ้าง",
  "ช่วยแต่งแคปชันโปรโมทห้องพักหน่อย",
];

export default function AiChatScreen({
  threadId,
  onBack,
  onPlanTrip,
  onOpenTrip,
  initialMessage,
  linkedPlanId,
}: AiChatScreenProps) {
  const insets = useSafeAreaInsets();
  const { getThread, appendMessage, createOrUpdateTripFromPlan } = useAiPlanner();
  const { folders } = useInteractions();
  const { user, session } = useAuth();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attachedFolderId, setAttachedFolderId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [originModalOpen, setOriginModalOpen] = useState(false);
  const [currentOrigin, setCurrentOrigin] = useState<{ label: string; address: string; url?: string; coords?: { lat: number; lng: number } } | null>(null);
  const [currentPlanId, setCurrentPlanId] = useState<string | undefined>(linkedPlanId);
  // บริบทโฟลเดอร์จริง (รายชื่อสถานที่ + ที่มา) — โหลดครั้งเดียวต่อโฟลเดอร์
  const [folderCtxState, setFolderCtxState] = useState<{
    folderId: string;
    ctx: FolderContextInfo | null;
  } | null>(null);
  // กำลังสร้างแพลนทริปจริงจากตัวสร้างของ backend
  const [planning, setPlanning] = useState(false);
  // Visible only for hosts (see toggle render below). "tourist" is the default
  // and matches the historical behaviour — every chat before this toggle went
  // through the public /ai-chat endpoint without an Authorization header.
  const [chatMode, setChatMode] = useState<"tourist" | "host-self">("tourist");
  const isHost = user?.role === "host";

  const listRef = useRef<FlatList<AiChatMessage>>(null);
  const autoSentRef = useRef(false);

  const thread = getThread(threadId);
  const threadFolder = thread?.folderId ? folders.find((f) => f.id === thread.folderId) : undefined;
  const attachedFolder = attachedFolderId ? folders.find((f) => f.id === attachedFolderId) : undefined;
  const folder = attachedFolder ?? threadFolder;

  // โหลดบริบทโฟลเดอร์จริง (ชื่อสถานที่ + ป้ายที่มา) — ใช้ทั้งในแชทและตอนกดสร้างแพลน
  const folderId = folder?.id;
  useEffect(() => {
    if (!folderId) return;
    let cancelled = false;
    (async () => {
      const ctx = await getFolderContext(folderId, session?.access_token ?? null).catch(
        () => null
      );
      if (!cancelled) setFolderCtxState({ folderId, ctx });
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId, session?.access_token]);

  // ใช้เฉพาะเมื่อเป็นบริบทของโฟลเดอร์ที่กำลังแสดงอยู่จริง
  const folderCtx =
    folderCtxState && folderCtxState.folderId === folderId ? folderCtxState.ctx : null;

  const handleSelectOrigin = (origin: { label: string; address: string; url?: string; coords?: { lat: number; lng: number } }) => {
    setCurrentOrigin(origin);
    const msg = `🚗 จุดเริ่มต้นเดินทางของฉัน: ${origin.label} (${origin.address})${origin.url ? `\nลิงก์: ${origin.url}` : ""}`;
    void send(msg);
  };

  const handleCreateTripFromChat = async (lastMessageContent: string) => {
    const threadTitle =
      thread?.title && thread.title !== "แชทใหม่" ? thread.title : "ทริปจากน้องโลคอล";
    setPlanning(true);
    try {
      // จุดหมาย = สถานที่จริงในโฟลเดอร์ (ชื่อที่ backend resolve ได้)
      let destinations: string[] = folderCtx?.places.map((p) => p.name) ?? [];
      if (destinations.length === 0 && folder) {
        // ทางสำรอง: ชื่อสถานที่ดิบจากคลิป (ไม่มีทะเบียนให้ยืนยัน)
        const dbCtx = await getFolderContextForAi(folder.id).catch(() => null);
        destinations = Array.from(
          new Set(
            (dbCtx?.clips ?? [])
              .map((c) => c.location_name || c.province)
              .filter(Boolean) as string[]
          )
        );
      }
      if (destinations.length === 0) destinations = ["ชุมชน OTOP ท่องเที่ยว"];

      // เรียกตัวสร้างแพลนจริงของ backend (ไม่แต่งไทม์ไลน์ปลอมในแอป)
      const result = await generateTrip(
        {
          startPoint: currentOrigin?.label || "บ้าน",
          destinations,
          days: 2,
          nights: 1,
          budgetPerPerson: 3000,
          style: "nature",
        },
        { folderId: folder?.id ?? null, token: session?.access_token ?? null }
      );

      const planId = result.planId || currentPlanId || `plan-${Date.now()}`;
      setCurrentPlanId(planId);

      const stops = (result.days ?? []).flatMap((d) => d.stops ?? []);
      const tripDestinations =
        destinations.length > 0
          ? destinations
          : Array.from(new Set(stops.map((s) => s.name).filter(Boolean)));

      const trip = createOrUpdateTripFromPlan({
        planId,
        title: result.title || threadTitle,
        summary:
          result.summary ||
          lastMessageContent.slice(0, 150) + "...",
        status: "draft",
        startPoint: currentOrigin?.label || "บ้าน",
        startPointUrl: currentOrigin?.url,
        startPointCoords: currentOrigin?.coords,
        destinations: tripDestinations,
        days: result.days?.length || 2,
        nights: Math.max(0, (result.days?.length || 2) - 1),
        budgetPerPerson: 3000,
        style: "nature",
        itinerary: result.days,
        budget: result.budget,
        sourceFolderId: folder?.id,
        // รายการสถานที่ของโฟลเดอร์พร้อมที่มา → ให้หน้าแพลนทริปแสดงด้วย
        folderPlaces: toTripFolderPlaces(folderCtx?.places),
      });

      // บอกตรง ๆ เมื่อได้ "แผนสำรอง" หรือโฟลเดอร์ยังไม่มีข้อมูลสถานที่
      if (result.source === "local-fallback") {
        Alert.alert(
          "ใช้แผนสำรองแทน",
          `${result.fallbackReason ?? "AI ไม่สำเร็จ"}\n\nแผนนี้มาจากเทมเพลตในแอป ไม่ใช่ AI — ดูรายละเอียดที่ Settings → AI Diagnostics`
        );
      } else if (result.folderWarning) {
        Alert.alert("แผนทริปพร้อมแล้ว", result.folderWarning);
      } else if (result.persisted === false) {
        Alert.alert(
          "แผนทริปพร้อมแล้ว",
          `บันทึกลงระบบไม่สำเร็จ (${result.persistReason ?? "ไม่ทราบสาเหตุ"}) — แผนยังอยู่ในเครื่องนี้`
        );
      }

      if (onOpenTrip) {
        onOpenTrip(trip.id);
      }
    } catch (err) {
      const aiErr = asAiError(err);
      Alert.alert(
        "สร้างแพลนไม่สำเร็จ",
        aiErr?.message ?? "เรียกตัวสร้างแพลนไม่สำเร็จ ลองใหม่อีกครั้ง"
      );
    } finally {
      setPlanning(false);
    }
  };

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || !thread || sending) return;

    // If a folder is attached, make it visible in the transcript too.
    const visibleContent = attachedFolder
      ? `📁 แนบโฟลเดอร์ "${attachedFolder.name}" (${attachedFolder.videoIds.length} คลิป)\n${body}`
      : body;

    appendMessage(threadId, { role: "user", content: visibleContent });
    setDraft("");
    setSending(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

    // If the user typed or pasted a Google Maps URL, pre-parse it so AI understands immediately
    let processedForAi = visibleContent;
    const gmapsMatch = body.match(/https?:\/\/(?:maps\.app\.goo\.gl\/[^\s]+|www\.google\.com\/maps[^\s]+)/i);
    if (gmapsMatch) {
      const url = gmapsMatch[0];
      const parsed = parseGoogleMapsUrl(url);
      if (parsed.lat && parsed.lng) {
        processedForAi = `${visibleContent}\n[ข้อมูลพิกัดจากลิงก์: ละติจูด ${parsed.lat.toFixed(4)}, ลองจิจูด ${parsed.lng.toFixed(4)}]`;
      } else {
        processedForAi = `${visibleContent}\n[หมายเหตุ: ลิงก์จุดเริ่มต้นการเดินทางของผู้ใช้ ให้เริ่มวางแผนจากจุดนี้ได้ทันที ไม่ต้องกดเปิดลิงก์ภายนอก]`;
      }
    }

    const history = [...thread.messages.map((m) => ({ role: m.role, content: m.content })), {
      role: "user" as const,
      content: processedForAi,
    }];

    // บริบทโฟลเดอร์ — ส่งรหัสโฟลเดอร์ไปให้ backend อ่านข้อมูลจริงเอง
    // (ถ้าโหลดไม่ได้ ค่อยส่งชื่อสถานที่ดิบไปเป็นทางสำรอง)
    let folderCtxPayload: { folderName: string; places: string[] } | undefined;
    if (folder) {
      const places = folderCtx?.places.map((p) => p.name) ?? [];
      folderCtxPayload = { folderName: folder.name, places };
    }

    try {
      const reply = await sendChat(history, {
        folder: folderCtxPayload,
        // ส่งรหัสโฟลเดอร์ → backend โหลดคลิปจริง + จับคู่ทะเบียนสถานที่เอง
        folderId: folder?.id ?? null,
        mode: chatMode,
        // ส่ง token ทุกครั้งที่มี session (backend ใช้ตรวจสิทธิ์เจ้าของโฟลเดอร์)
        token: session?.access_token ?? undefined,
        // ชุมชนของผู้ใช้เอง → ให้ backend ดึงสถานที่ในชุมชนนั้นมาตอบ (D22)
        communityId: user?.community_id ?? null,
      });
      appendMessage(threadId, { role: "assistant", content: reply });
      setAttachedFolderId(null); // attachment is one-shot per send
    } catch (err) {
      // Previously this fell through and appended the failure as an assistant
      // message, so a 401 looked exactly like a real answer. Mark it instead.
      const aiErr = asAiError(err);
      const detail = aiErr
        ? `${aiErr.message}\n\n(${aiErr.status !== null ? `HTTP ${aiErr.status} · ` : ""}${aiErr.requestId ? `req ${aiErr.requestId} · ` : ""}${Math.round(aiErr.durationMs)}ms)`
        : "ส่งข้อความไม่สำเร็จ";
      console.warn("[aiChat] FAIL", detail);
      appendMessage(threadId, { role: "assistant", content: detail, isError: true });
    } finally {
      // Without this, any throw above wedged `sending` on forever and the
      // composer could never be used again without remounting the screen.
      setSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  // Auto-send the seed message once (used when opened from the AI-summary
  // "คุยต่อกับ AI" button). Only fires on an empty thread.
  useEffect(() => {
    if (
      initialMessage &&
      initialMessage.trim() &&
      !autoSentRef.current &&
      thread &&
      thread.messages.length === 0
    ) {
      autoSentRef.current = true;
      void send(initialMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage, thread]);

  const isEmpty = !thread || thread.messages.length === 0;

  return (
    <View className="flex-1 bg-white">
      {/* Header */}
      <View
        style={{ paddingTop: Math.max(insets.top, 12) + 6 }}
        className="flex-row items-center px-3 pb-3 border-b border-gray-100"
      >
        <TouchableOpacity onPress={onBack} className="p-1 mr-1">
          <ArrowLeftIcon size={24} color="#18181B" strokeWidth={2} />
        </TouchableOpacity>
        <View className="w-9 h-9 rounded-full bg-violet-100 items-center justify-center mr-2.5">
          {folder ? <FolderIcon size={18} color="#7C3AED" /> : <SparklesIcon size={18} color="#7C3AED" />}
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-bold text-gray-900" numberOfLines={1}>
            {thread?.title ?? "แชท AI"}
          </Text>
          <Text className="text-[11px] text-gray-400">
            {folder
              ? `จากโฟลเดอร์ • ${folderCtx?.clipCount ?? folder.videoIds.length} คลิป`
              : "แชททั่วไป"}
          </Text>
        </View>
        {folder && onPlanTrip && (
          <TouchableOpacity
            onPress={() => onPlanTrip(folder.id)}
            activeOpacity={0.8}
            className="bg-violet-600 px-3 py-2 rounded-full flex-row items-center"
          >
            <SparklesIcon size={14} color="#FFFFFF" />
            <Text className="text-white text-[12px] font-bold ml-1">วางแผนทริป</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Mode toggle — visible only for hosts. Defaults to the historical
          tourist behaviour; host-self is a JWT-gated advisor that reads the
          host's own business data. Switching mode does NOT clear the thread,
          but each send tags the new mode, so the prompt rebuilds fresh. */}
      {isHost && (
        <View className="flex-row bg-gray-100 rounded-full p-1 mx-4 my-2 self-stretch">
          <TouchableOpacity
            onPress={() => setChatMode("tourist")}
            activeOpacity={0.8}
            className={`flex-1 py-2 rounded-full items-center ${
              chatMode === "tourist" ? "bg-white shadow-sm" : ""
            }`}
          >
            <Text
              className={`text-[13px] ${
                chatMode === "tourist" ? "font-bold text-gray-900" : "text-gray-500 font-medium"
              }`}
            >
              ถามทั่วไป
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setChatMode("host-self")}
            activeOpacity={0.8}
            className={`flex-1 py-2 rounded-full items-center ${
              chatMode === "host-self" ? "bg-emerald-700 shadow-sm" : ""
            }`}
          >
            <Text
              className={`text-[13px] ${
                chatMode === "host-self" ? "font-bold text-white" : "text-gray-500 font-medium"
              }`}
            >
              ถามเกี่ยวกับร้านฉัน
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Messages / empty state */}
      {isEmpty ? (
        <View className="flex-1 px-6 justify-center">
          <View className="items-center mb-8">
            <View className="w-16 h-16 rounded-3xl bg-violet-100 items-center justify-center mb-3">
              <SparklesIcon size={30} color="#7C3AED" />
            </View>
            <Text className="text-xl font-black text-gray-900">
              {chatMode === "host-self" ? "ผู้ช่วยธุรกิจ" : "AI ช่วยคิด"}
            </Text>
            <Text className="text-gray-500 text-[13px] text-center mt-1 leading-5">
              {chatMode === "host-self"
                ? "ถามเกี่ยวกับธุรกิจของคุณได้เลย — AI จะตอบจากข้อมูลที่ลงทะเบียนไว้ในระบบ"
                : folder
                  ? `ถามอะไรก็ได้เกี่ยวกับคลิปในโฟลเดอร์ "${folder.name}" หรือกด "วางแผนทริป" ได้เลย`
                  : "ผู้ช่วยวางแผนเที่ยว ถามเรื่องที่พัก เส้นทาง อาหารพื้นถิ่น หรือวางแผนทริปได้เลย"}
            </Text>
          </View>
          {(chatMode === "host-self" ? HOST_SUGGESTIONS : SUGGESTIONS).map((s, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => send(s)}
              activeOpacity={0.7}
              className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 mb-2.5"
            >
              <Text className="text-gray-700 text-[13px]">{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={thread!.messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingVertical: 14, paddingHorizontal: 14 }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const mine = item.role === "user";
            const failed = Boolean(item.isError);
            return (
              <View className={`mb-3 flex-row ${mine ? "justify-end" : "justify-start"}`}>
                {!mine && (
                  <View
                    className={`w-7 h-7 rounded-full items-center justify-center mr-2 mt-0.5 ${
                      failed ? "bg-red-100" : "bg-violet-100"
                    }`}
                  >
                    {failed ? (
                      <ExclamationTriangleIcon size={14} color="#DC2626" />
                    ) : (
                      <SparklesIcon size={14} color="#7C3AED" />
                    )}
                  </View>
                )}
                <View className="max-w-[88%]">
                  <View
                    className={
                      failed
                        ? "px-3.5 py-2.5 rounded-2xl bg-red-50 border border-red-200 self-start"
                        : mine
                        ? "px-3.5 py-2.5 rounded-2xl bg-[#2D6A4F] rounded-br-md self-end"
                        : "py-1 self-start"
                    }
                  >
                    {failed ? (
                      <Text className="text-[12px] font-bold text-red-700 mb-1">
                        ⚠️ AI ตอบไม่สำเร็จ
                      </Text>
                    ) : null}
                    <Text
                      className={`text-[14px] leading-6 ${
                        failed ? "text-red-800" : mine ? "text-white font-medium" : "text-gray-900"
                      }`}
                    >
                      {item.content}
                    </Text>
                  </View>

                  {failed ? (
                    <TouchableOpacity
                      onPress={() => {
                        const lastUser = [...thread.messages]
                          .reverse()
                          .find((m) => m.role === "user");
                        if (lastUser) send(lastUser.content);
                      }}
                      activeOpacity={0.8}
                      className="mt-2 bg-red-600 rounded-xl px-3.5 py-2 flex-row items-center self-start"
                    >
                      <ArrowPathIcon size={15} color="#FFFFFF" />
                      <Text className="text-white text-[12.5px] font-bold ml-1.5">ลองใหม่อีกครั้ง</Text>
                    </TouchableOpacity>
                  ) : null}

                  {/* If assistant gave a trip plan response, show "เลือกแพลนทริปนี้" button */}
                  {!mine && !failed && (item.content.includes("วัน") || item.content.includes("ทริป") || item.content.includes("เดินทาง") || item.content.includes("แผน")) && (
                    <TouchableOpacity
                      onPress={() => handleCreateTripFromChat(item.content)}
                      disabled={planning}
                      activeOpacity={0.8}
                      className={`mt-2 rounded-xl px-3.5 py-2.5 flex-row items-center self-start shadow-sm ${
                        planning ? "bg-violet-300" : "bg-violet-600"
                      }`}
                    >
                      {planning ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <CalendarDaysIcon size={16} color="#FFFFFF" />
                      )}
                      <Text className="text-white text-[12.5px] font-bold ml-1.5">
                        {planning
                          ? "กำลังสร้างแพลน..."
                          : currentPlanId
                          ? "อัปเดตทริปที่แพลนไว้ ➔"
                          : "เลือกแพลนทริปนี้ (บันทึกร่าง) ➔"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          }}
          ListFooterComponent={
            sending ? (
              <View className="flex-row items-center ml-9 mb-3">
                <ActivityIndicator size="small" color="#7C3AED" />
                <Text className="text-gray-400 text-[12px] ml-2">กำลังคิด...</Text>
              </View>
            ) : null
          }
        />
      )}

      {/* Composer */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Origin display chip if chosen */}
        {currentOrigin && (
          <View className="flex-row items-center mx-3 mt-1.5 bg-violet-50 border border-violet-200 rounded-xl px-3 py-1.5">
            <MapPinIcon size={14} color="#7C3AED" />
            <Text className="flex-1 text-violet-800 text-[11.5px] font-semibold ml-1.5" numberOfLines={1}>
              เริ่มจาก: {currentOrigin.label} ({currentOrigin.address})
            </Text>
            <TouchableOpacity onPress={() => setCurrentOrigin(null)} className="p-0.5">
              <XMarkIcon size={14} color="#7C3AED" />
            </TouchableOpacity>
          </View>
        )}

        {/* Attached-folder chip (only for a per-message attachment) */}
        {attachedFolder && (
          <View className="flex-row items-center mx-3 mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <FolderIcon size={16} color="#D47A3A" />
            <Text className="flex-1 text-amber-800 text-[12px] font-semibold ml-2" numberOfLines={1}>
              {attachedFolder.name} • {attachedFolder.videoIds.length} คลิป
            </Text>
            <TouchableOpacity onPress={() => setAttachedFolderId(null)} className="p-0.5">
              <XMarkIcon size={16} color="#B45309" />
            </TouchableOpacity>
          </View>
        )}

        {/* การ์ดโฟลเดอร์: รายชื่อสถานที่จริงที่โฟลเดอร์นี้ไป (แหล่งข้อมูลเดียวกับหน้าโฟลเดอร์) */}
        {folder && folderCtx && folderCtx.places.length > 0 && (
          <View className="mx-3 mt-2 bg-violet-50 border border-violet-100 rounded-xl px-3 py-2.5">
            <View className="flex-row items-center">
              <FolderIcon size={14} color="#7C3AED" />
              <Text className="text-violet-800 text-[11.5px] font-bold ml-1.5" numberOfLines={1}>
                {folder.name} • {folderCtx.clipCount} คลิป • {folderCtx.places.length} สถานที่
              </Text>
            </View>
            <View className="flex-row flex-wrap mt-1.5">
              {folderCtx.places.slice(0, 6).map((p) => (
                <View
                  key={p.key}
                  className={`flex-row items-center rounded-full px-2 py-0.5 mr-1.5 mb-1 ${
                    p.source === "registry" ? "bg-emerald-100" : "bg-amber-100"
                  }`}
                >
                  {p.source === "registry" ? (
                    <CheckBadgeIcon size={10} color="#059669" />
                  ) : (
                    <QuestionMarkCircleIcon size={10} color="#D97706" />
                  )}
                  <Text
                    className={`text-[10.5px] font-semibold ml-1 ${
                      p.source === "registry" ? "text-emerald-800" : "text-amber-800"
                    }`}
                  >
                    {p.name}
                  </Text>
                </View>
              ))}
              {folderCtx.places.length > 6 ? (
                <Text className="text-[10.5px] text-gray-500 self-center">
                  +{folderCtx.places.length - 6} แห่ง
                </Text>
              ) : null}
            </View>
            <Text className="text-[10.5px] text-gray-500">
              ลงทะเบียนแล้ว {folderCtx.registryHits} · จากคลิป {folderCtx.aiFallbacks}
            </Text>
          </View>
        )}

        <View
          className="flex-row items-center px-3 pt-2 border-t border-gray-100"
          style={{ paddingBottom: Math.max(insets.bottom, 10) }}
        >
          {/* Quick Origin Selector Button (House/Pin) */}
          <TouchableOpacity
            onPress={() => setOriginModalOpen(true)}
            disabled={sending}
            activeOpacity={0.7}
            className="w-10 h-10 rounded-full bg-violet-50 items-center justify-center mr-1.5 border border-violet-200"
          >
            <MapPinIcon size={18} color="#7C3AED" />
          </TouchableOpacity>

          {/* Attach a saved-clip folder */}
          {!threadFolder && (
            <TouchableOpacity
              onPress={() => setPickerOpen(true)}
              disabled={sending}
              activeOpacity={0.7}
              className="w-10 h-10 rounded-full bg-gray-100 items-center justify-center mr-2"
            >
              <PaperClipIcon size={18} color={attachedFolder ? "#D47A3A" : "#6B7280"} />
            </TouchableOpacity>
          )}

          <View className="flex-1 bg-gray-100 rounded-full px-4 py-2.5">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="ถามน้องโลคอล..."
              placeholderTextColor="#9CA3AF"
              className="text-[14px] text-gray-900 py-0"
              multiline
              editable={!sending}
            />
          </View>
          <TouchableOpacity
            onPress={() => send(draft)}
            disabled={!draft.trim() || sending}
            activeOpacity={0.8}
            className={`ml-2 w-11 h-11 rounded-full items-center justify-center ${
              draft.trim() && !sending ? "bg-violet-600" : "bg-gray-200"
            }`}
          >
            <PaperAirplaneIcon size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Folder picker — pick a saved-clip folder to attach to the next message */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setPickerOpen(false)}>
          <View className="flex-1 bg-black/40" />
        </TouchableWithoutFeedback>
        <View
          className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl"
          style={{ maxHeight: "70%", paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <View className="items-center pt-2.5 pb-1">
            <View className="w-10 h-1.5 rounded-full bg-gray-300" />
          </View>
          <View className="px-5 pt-1 pb-3 flex-row items-center justify-between border-b border-gray-100">
            <Text className="text-[16px] font-black text-gray-900">แนบโฟลเดอร์คลิป</Text>
            <TouchableOpacity onPress={() => setPickerOpen(false)} className="p-1">
              <XMarkIcon size={22} color="#6B7280" />
            </TouchableOpacity>
          </View>
          <FlatList
            data={folders}
            keyExtractor={(f) => f.id}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => {
                  setAttachedFolderId(item.id);
                  setPickerOpen(false);
                }}
                activeOpacity={0.8}
                className="flex-row items-center bg-gray-50 border border-gray-100 rounded-2xl p-4 mb-2.5"
              >
                <View className="w-11 h-11 rounded-2xl bg-amber-100 items-center justify-center mr-3">
                  <FolderIcon size={22} color="#D47A3A" />
                </View>
                <View className="flex-1">
                  <Text className="text-gray-900 font-bold text-[14px]">{item.name}</Text>
                  <Text className="text-gray-400 text-[12px]">{item.videoIds.length} คลิปที่บันทึก</Text>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View className="py-14 items-center px-8">
                <FolderIcon size={40} color="#D1D5DB" />
                <Text className="text-gray-400 text-sm text-center mt-3 leading-5">
                  ยังไม่มีโฟลเดอร์ ไปที่หน้าหลักแล้วกดบันทึกคลิปที่ชอบลงโฟลเดอร์ก่อน
                </Text>
              </View>
            }
          />
        </View>
      </Modal>

      {/* Origin selector modal */}
      <OriginSelectorModal
        visible={originModalOpen}
        onClose={() => setOriginModalOpen(false)}
        onSelectOrigin={handleSelectOrigin}
      />
    </View>
  );
}
