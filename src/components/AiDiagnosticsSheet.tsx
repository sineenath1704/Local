import React, { useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  Share,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { XMarkIcon } from "react-native-heroicons/outline";
import {
  AiCallRecord,
  clearRecords,
  describeBaseUrl,
  kindColor,
  kindLabel,
  useAiDiagnostics,
} from "../services/aiDiagnostics";
import { API_BASE_URL } from "../services/apiConfig";

/**
 * AI Diagnostics — the answer to "ติดตรงไหน".
 * =============================================================
 * Shows every AI call the app has made this session: which URL, which status,
 * how long, and what the backend actually said. The single most useful thing
 * on screen is the resolved API_BASE_URL at the top — that alone reveals
 * whether the app is talking to localhost or to a deployed backend.
 */

interface AiDiagnosticsSheetProps {
  visible: boolean;
  onClose: () => void;
}

interface ProbeResult {
  state: "idle" | "running" | "done";
  text: string;
  ok: boolean | null;
}

function timeOf(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function duration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** Round-trip a raw fetch to /health without going through aiFetch (it isn't an AI call). */
async function probeHealth(): Promise<{ ok: boolean; text: string }> {
  const url = `${API_BASE_URL}/health`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    let pretty = text;
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* keep raw text */
    }
    return { ok: res.ok, text: `${res.status} ${res.statusText}\n\n${pretty}` };
  } catch (err: any) {
    return { ok: false, text: `ต่อ ${url} ไม่ได้\n${err?.message ?? "unknown"}` };
  }
}

function Row({ record }: { record: AiCallRecord }) {
  const [open, setOpen] = useState(false);
  const color = kindColor(record.errorKind);
  const ok = record.outcome === "ok";

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => setOpen((v) => !v)}
      className="bg-white rounded-2xl border border-gray-200 px-4 py-3 mb-2"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <Text style={{ color, fontSize: 15, fontWeight: "800", marginRight: 8 }}>
            {ok ? "✓" : "✗"}
          </Text>
          <Text className="text-gray-900 font-bold text-[13px] flex-1" numberOfLines={1}>
            {record.label}
          </Text>
        </View>
        <Text className="text-gray-500 text-[11px]">
          {record.status ?? "—"} · {duration(record.durationMs)}
        </Text>
      </View>

      <View className="flex-row items-center justify-between mt-1">
        <Text style={{ color }} className="text-[11px] font-semibold">
          {kindLabel(record.errorKind)}
        </Text>
        <Text className="text-gray-400 text-[10px]">
          {timeOf(record.startedAt)}
          {record.requestId ? ` · req ${record.requestId}` : ""}
        </Text>
      </View>

      {!ok && record.errorMessage ? (
        <Text className="text-gray-700 text-[12px] mt-1.5 leading-4">
          {record.errorMessage}
        </Text>
      ) : null}

      {open ? (
        <View className="mt-3 pt-3 border-t border-gray-100">
          <Text className="text-gray-500 text-[11px] font-semibold mb-1">REQUEST</Text>
          <Text className="text-gray-800 text-[11px] font-mono mb-3">
            {record.method} {record.url}
          </Text>

          {record.requestPreview ? (
            <>
              <Text className="text-gray-500 text-[11px] font-semibold mb-1">BODY ที่ส่ง</Text>
              <Text className="text-gray-600 text-[11px] font-mono mb-3">
                {record.requestPreview}
              </Text>
            </>
          ) : null}

          <Text className="text-gray-500 text-[11px] font-semibold mb-1">RESPONSE</Text>
          <Text className="text-gray-600 text-[11px] font-mono mb-3">
            {record.responsePreview || "(ไม่ได้รับ body)"}
          </Text>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() =>
              Share.share({
                message: [
                  `label:    ${record.label}`,
                  `url:      ${record.method} ${record.url}`,
                  `status:   ${record.status ?? "(ไม่ได้ตอบ)"}`,
                  `duration: ${record.durationMs}ms`,
                  `requestId:${record.requestId ?? "-"}`,
                  `kind:     ${record.errorKind ?? "ok"}`,
                  `error:    ${record.errorMessage ?? "-"}`,
                  "",
                  `request:  ${record.requestPreview || "-"}`,
                  `response: ${record.responsePreview || "-"}`,
                ].join("\n"),
              }).catch(() => {})
            }
            className="self-start px-3 py-1.5 rounded-lg bg-gray-100"
          >
            <Text className="text-gray-700 text-[12px] font-semibold">ส่งรายละเอียดออก</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export default function AiDiagnosticsSheet({ visible, onClose }: AiDiagnosticsSheetProps) {
  const insets = useSafeAreaInsets();
  const records = useAiDiagnostics();
  const [probe, setProbe] = useState<ProbeResult>({ state: "idle", text: "", ok: null });

  const runProbe = async () => {
    setProbe({ state: "running", text: "กำลังยิง…", ok: null });
    const result = await probeHealth();
    setProbe({ state: "done", text: result.text, ok: result.ok });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-gray-50">
        <View
          className="bg-white border-b border-gray-200 px-5 pb-3"
          style={{ paddingTop: Math.max(insets.top, 12) }}
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-black text-gray-900">AI Diagnostics</Text>
            <TouchableOpacity onPress={onClose} className="p-1">
              <XMarkIcon size={22} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <View className="bg-gray-900 rounded-xl px-3 py-2.5 mt-3">
            <Text className="text-gray-400 text-[10px] font-semibold">API_BASE_URL (ที่แอปยิงจริง)</Text>
            <Text className="text-white text-[12px] font-mono mt-0.5" selectable>
              {describeBaseUrl()}
            </Text>
            <Text className="text-gray-500 text-[10px] mt-1.5">
              platform: {Platform.OS} · บันทึกล่าสุด {records.length}/50
            </Text>
          </View>

          <View className="flex-row gap-2 mt-3">
            <TouchableOpacity
              onPress={runProbe}
              disabled={probe.state === "running"}
              activeOpacity={0.8}
              className={`flex-1 py-2.5 rounded-xl items-center ${
                probe.state === "running" ? "bg-gray-300" : "bg-emerald-600"
              }`}
            >
              <Text className="text-white font-bold text-[13px]">
                {probe.state === "running" ? "กำลังตรวจ…" : "ทดสอบเชื่อมต่อ /health"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                clearRecords();
                Alert.alert("ล้างแล้ว", "ลบประวัติ AI ทั้งหมดเรียบร้อย");
              }}
              activeOpacity={0.8}
              className="px-4 py-2.5 rounded-xl bg-gray-200 items-center"
            >
              <Text className="text-gray-700 font-bold text-[13px]">ล้าง</Text>
            </TouchableOpacity>
          </View>

          {probe.state === "done" ? (
            <View
              className="rounded-xl px-3 py-2.5 mt-3"
              style={{ backgroundColor: probe.ok ? "#DCFCE7" : "#FEE2E2" }}
            >
              <Text
                className="text-[12px] font-bold"
                style={{ color: probe.ok ? "#166534" : "#991B1B" }}
              >
                {probe.ok ? "ต่อ backend สำเร็จ" : "ต่อ backend ไม่สำเร็จ"}
              </Text>
              <Text className="text-gray-800 text-[11px] font-mono mt-1" selectable>
                {probe.text}
              </Text>
            </View>
          ) : null}
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: Math.max(insets.bottom, 12) + 24,
          }}
        >
          {records.length === 0 ? (
            <View className="mt-10 items-center">
              <Text className="text-gray-500 text-[13px] text-center leading-5">
                ยังไม่มีการเรียก AI ในเซสชันนี้
              </Text>
              {probe.state === "idle" ? (
                <Text className="text-gray-400 text-[12px] mt-2 text-center">
                  ลองกด &quot;ทดสอบเชื่อมต่อ&quot; ด้านบนก่อน
                </Text>
              ) : null}
            </View>
          ) : (
            <>
              <Text className="text-gray-500 text-[11px] mb-2">
                แตะแต่ละแถวเพื่อดู request / response เต็ม
              </Text>
              {records.map((r) => (
                <Row key={r.id} record={r} />
              ))}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}