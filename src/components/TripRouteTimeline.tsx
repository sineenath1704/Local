import React from "react";
import { View, Text } from "react-native";
import {
  ClockIcon,
  TruckIcon,
  BanknotesIcon,
  MapPinIcon,
  FlagIcon,
  HomeModernIcon,
  BuildingStorefrontIcon,
  SparklesIcon,
  ArrowRightCircleIcon,
} from "react-native-heroicons/outline";
import { TripPlanDay, TripPlanLeg, TripPlanStop } from "../data/tripsData";

/**
 * ไทม์ไลน์ "เวลา — สถานที่"
 * =============================================================
 * กล่องซ้อนกันลงล่าง ใช้ 2 ที่:
 *   · 1) การ์ดสรุปแพลนในแชท (โหมด "summary" ของ TripPlanCard)
 *   · 2) หน้าทริป (ItineraryViewer) — ใช้รูปแบบเดียวกัน
 *
 * รูปแบบตรงกับหน้าทริป: แถบบน = เวลา + ป้ายประเภท · กลาง = ชื่อ + กิจกรรม + แท็ก
 * · ท้าย = เวลาเดินทางไปจุดถัดไป
 */

interface StopStyle {
  dotColor: string;
  badgeBg: string;
  badgeText: string;
  label: string;
  Icon: React.ComponentType<{ size: number; color: string }>;
}

/**
 * เดาประเภทจากข้อความที่ backend ส่งมา
 * (TripPlanStop.type เป็น string อิสระ เช่น "ที่พัก", "ร้านอาหาร", "วัด")
 */
function stopStyle(raw?: string | null): StopStyle {
  const t = (raw ?? "").trim().toLowerCase();
  if (t.includes("ที่พัก") || t.includes("พัก") || t.includes("โรงแรม") || t.includes("accommodation") || t.includes("hotel")) {
    return { dotColor: "#7C3AED", badgeBg: "#F5F3FF", badgeText: "#5B21B6", label: "ที่พัก", Icon: HomeModernIcon };
  }
  if (t.includes("อาหาร") || t.includes("ร้าน") || t.includes("food") || t.includes("restaurant")) {
    return { dotColor: "#F59E0B", badgeBg: "#FFFBEB", badgeText: "#92400E", label: "อาหาร", Icon: SparklesIcon };
  }
  if (t.includes("คาเฟ่") || t.includes("cafe") || t.includes("กาแฟ")) {
    return { dotColor: "#D97706", badgeBg: "#FEF3C7", badgeText: "#92400E", label: "คาเฟ่", Icon: BuildingStorefrontIcon };
  }
  if (t.includes("ชุมชน") || t.includes("วัด") || t.includes("ศาสนา") || t.includes("community") || t.includes("temple")) {
    return { dotColor: "#2D6A4F", badgeBg: "#ECFDF5", badgeText: "#065F46", label: "ชุมชน OTOP", Icon: HomeModernIcon };
  }
  if (t.includes("กิจกรรม") || t.includes("activity") || t.includes("เดินป่า")) {
    return { dotColor: "#0891B2", badgeBg: "#ECFEFF", badgeText: "#164E63", label: "กิจกรรม", Icon: SparklesIcon };
  }
  if (t.includes("กลับ") || t.includes("return")) {
    return { dotColor: "#64748B", badgeBg: "#F1F5F9", badgeText: "#475569", label: "เดินทางกลับ", Icon: ArrowRightCircleIcon };
  }
  if (t.includes("เริ่ม") || t.includes("departure")) {
    return { dotColor: "#6366F1", badgeBg: "#EEF2FF", badgeText: "#4338CA", label: "เริ่มต้น", Icon: FlagIcon };
  }
  return { dotColor: "#EF4444", badgeBg: "#FEF2F2", badgeText: "#B91C1C", label: "สถานที่ท่องเที่ยว", Icon: MapPinIcon };
}

function driveLabel(mins?: number | null): string {
  if (mins == null || mins <= 0) return "";
  if (mins < 60) return `ขับรถ ~${Math.round(mins)} นาที`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins) % 60;
  return `ขับรถ ~${h} ชม.${m ? ` ${m} นาที` : ""}`;
}

interface TripRouteTimelineProps {
  days: TripPlanDay[];
}

/**
 * แถว "จุดเริ่มต้น" — แถวแรกของแต่ละวัน
 * -------------------------------------------------------------
 * จุดเริ่มต้นไม่อยู่ใน `day.stops` (มันคือจุดที่บันทึกไว้ ไม่ใช่จุดแวะของทริป)
 * แต่การ์ดแผนในแชทต้องอ่านออกว่า จุดเริ่มต้น → จุดเที่ยว → จุดกลับ
 * → วาดแยกแถวหนึ่ง พร้อมระยะ/เวลาของขาแรก (fromIndex = 0)
 */
function StartPointRow({
  label,
  address,
  leg,
}: {
  label?: string | null;
  address?: string | null;
  leg?: TripPlanLeg;
}) {
  if (!label) return null;
  const cfg = stopStyle("departure");
  return (
    <View className="flex-row mb-1">
      {/* เส้นไทม์ไลน์ */}
      <View className="items-center mr-3" style={{ width: 24 }}>
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: cfg.dotColor,
            marginTop: 14,
          }}
        />
        <View
          style={{
            width: 2,
            flex: 1,
            backgroundColor: cfg.dotColor + "35",
            marginVertical: 3,
          }}
        />
      </View>

      {/* กล่องจุดเริ่มต้น */}
      <View
        className="flex-1 rounded-2xl mb-3 overflow-hidden"
        style={{
          borderWidth: 1,
          borderColor: cfg.dotColor + "30",
          backgroundColor: "#FAFAFA",
        }}
      >
        {/* แถบบน: ป้ายประเภท */}
        <View
          className="flex-row items-center justify-between px-3.5 py-2"
          style={{ backgroundColor: cfg.dotColor + "10" }}
        >
          <View className="flex-row items-center">
            <MapPinIcon size={13} color={cfg.dotColor} />
            <Text
              style={{ color: cfg.dotColor, fontSize: 12, fontWeight: "700", marginLeft: 4 }}
            >
              จุดเริ่มต้นของวัน
            </Text>
          </View>
          <View
            className="flex-row items-center rounded-full px-2.5 py-0.5"
            style={{ backgroundColor: cfg.badgeBg }}
          >
            <cfg.Icon size={11} color={cfg.badgeText} />
            <Text
              style={{ color: cfg.badgeText, fontSize: 10, fontWeight: "700", marginLeft: 3 }}
            >
              {cfg.label}
            </Text>
          </View>
        </View>

        {/* เนื้อหา */}
        <View className="px-3.5 py-2.5">
          <Text className="text-[14px] font-bold text-gray-900 mb-0.5">{label}</Text>
          {address ? (
            <Text className="text-[11px] text-gray-400 mt-0.5 italic">{address}</Text>
          ) : null}
        </View>

        {/* ขาแรก: จุดเริ่มต้น → จุดแรก */}
        {leg ? (
          <View
            className="flex-row items-center px-3.5 py-2 border-t border-dashed"
            style={{ borderColor: cfg.dotColor + "25" }}
          >
            <TruckIcon size={12} color={cfg.dotColor} />
            <Text
              style={{ color: cfg.dotColor, fontSize: 11, marginLeft: 5 }}
            >
              {driveLabel(leg.minutes) || "เดินทาง"}
              {leg.km != null ? ` · ${leg.km.toFixed(1)} กม.` : ""} ไปจุดแรก
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function TripRouteTimeline({ days }: TripRouteTimelineProps) {
  const list = days ?? [];

  if (list.length === 0) {
    return (
      <View className="px-4 py-6 items-center">
        <Text className="text-[12.5px] text-gray-400">ยังไม่มีจุดแวะในแผน</Text>
      </View>
    );
  }

  return (
    <View className="px-4 py-3">
      {list.map((day) => {
        const stops = day.stops ?? [];
        return (
          <View key={`tl-day-${day.day}`} className="mb-4">
            {/* ── หัววัน ───────────────────────────────────────── */}
            <View className="flex-row items-center mb-3">
              <View className="bg-violet-600 rounded-xl px-3 py-1.5">
                <Text className="text-white font-black text-[13px]">Day {day.day}</Text>
              </View>
              <View className="flex-1 h-px bg-gray-200 ml-3" />
            </View>

            {stops.length === 0 ? (
              <Text className="text-[12px] text-gray-400 mb-2">ไม่มีจุดแวะในวันนี้</Text>
            ) : null}

            {/* ── จุดเริ่มต้น (แถวแรกของแพลน) ───────────────────────── */}
            <StartPointRow
              label={day.startPoint?.label}
              address={day.startPoint?.address ?? null}
              leg={(day.legs ?? []).find((l) => l.fromIndex === 0)}
            />

            {/* ── กล่องจุดแวะ ──────────────────────────────────── */}
            {stops.map((stop: TripPlanStop, si: number) => {
              const cfg = stopStyle(stop.type);
              const isLast = si === stops.length - 1;
              const time = stop.arriveTime ?? stop.leaveTime ?? "";
              return (
                <View key={`tl-${day.day}-${stop.id ?? si}`} className="flex-row mb-1">
                  {/* เส้นไทม์ไลน์ */}
                  <View className="items-center mr-3" style={{ width: 24 }}>
                    <View
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 7,
                        backgroundColor: cfg.dotColor,
                        marginTop: 14,
                      }}
                    />
                    {!isLast ? (
                      <View
                        style={{
                          width: 2,
                          flex: 1,
                          backgroundColor: cfg.dotColor + "35",
                          marginVertical: 3,
                        }}
                      />
                    ) : null}
                  </View>

                  {/* กล่อง */}
                  <View
                    className="flex-1 rounded-2xl mb-3 overflow-hidden"
                    style={{
                      borderWidth: 1,
                      borderColor: cfg.dotColor + "30",
                      backgroundColor: "#FAFAFA",
                    }}
                  >
                    {/* แถบบน: เวลา + ป้ายประเภท */}
                    <View
                      className="flex-row items-center justify-between px-3.5 py-2"
                      style={{ backgroundColor: cfg.dotColor + "10" }}
                    >
                      <View className="flex-row items-center">
                        <ClockIcon size={13} color={cfg.dotColor} />
                        <Text
                          style={{ color: cfg.dotColor, fontSize: 12, fontWeight: "700", marginLeft: 4 }}
                        >
                          {time}
                        </Text>
                      </View>
                      <View
                        className="flex-row items-center rounded-full px-2.5 py-0.5"
                        style={{ backgroundColor: cfg.badgeBg }}
                      >
                        <cfg.Icon size={11} color={cfg.badgeText} />
                        <Text
                          style={{ color: cfg.badgeText, fontSize: 10, fontWeight: "700", marginLeft: 3 }}
                        >
                          {cfg.label}
                        </Text>
                      </View>
                    </View>

                    {/* เนื้อหา */}
                    <View className="px-3.5 py-2.5">
                      <Text className="text-[14px] font-bold text-gray-900 mb-0.5">
                        {stop.name}
                      </Text>
                      {stop.activity ? (
                        <Text className="text-[12.5px] text-gray-500 mb-2">{stop.activity}</Text>
                      ) : null}

                      <View className="flex-row flex-wrap items-center">
                        {stop.stayHours ? (
                          <View className="flex-row items-center bg-white rounded-full px-2.5 py-1 mr-1.5 mb-1 border border-gray-200">
                            <ClockIcon size={11} color="#6B7280" />
                            <Text className="text-[11px] text-gray-600 ml-1">
                              {stop.stayHours} ชม.
                            </Text>
                          </View>
                        ) : null}
                        {stop.estimatedCost ? (
                          <View className="flex-row items-center bg-white rounded-full px-2.5 py-1 mr-1.5 mb-1 border border-gray-200">
                            <BanknotesIcon size={11} color="#6B7280" />
                            <Text className="text-[11px] text-gray-600 ml-1">
                              ~{Math.round(stop.estimatedCost).toLocaleString("th-TH")} ฿
                            </Text>
                          </View>
                        ) : null}
                        {stop.verified === false ? (
                          <View className="bg-amber-50 rounded-full px-2.5 py-1 mr-1.5 mb-1 border border-amber-200">
                            <Text className="text-[10px] text-amber-700">ข้อมูลประมาณการ</Text>
                          </View>
                        ) : null}
                      </View>

                      {stop.note ? (
                        <Text className="text-[11px] text-gray-400 mt-0.5 italic">{stop.note}</Text>
                      ) : null}
                    </View>

                    {/* เวลาเดินทางไปจุดถัดไป */}
                    {!isLast && stop.driveToNextMins ? (
                      <View
                        className="flex-row items-center px-3.5 py-2 border-t border-dashed"
                        style={{ borderColor: cfg.dotColor + "25" }}
                      >
                        <TruckIcon size={12} color={cfg.dotColor} />
                        <Text
                          style={{ color: cfg.dotColor, fontSize: 11, marginLeft: 5 }}
                        >
                          {driveLabel(stop.driveToNextMins)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
