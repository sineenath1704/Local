import React, { useEffect, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AiToastPayload,
  kindColor,
  subscribeToasts,
} from "../services/aiDiagnostics";

/**
 * AI error toasts.
 * =============================================================
 * Built on Animated + View only — no toast library — so this works in Expo Go
 * without a development build (a native toast package would require one).
 *
 * Mounted once at the app root. Toasts arrive on the bus in aiDiagnostics.ts;
 * success is never toasted, only failures are worth interrupting someone for.
 */

const TOAST_MS = 6000;

function Toast({ payload, onDone }: { payload: AiToastPayload; onDone: () => void }) {
  // A stable instance created once — `useRef` would be read during render,
  // which the react-hooks lint rule (rightly) rejects outside of effects.
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    Animated.timing(anim, { toValue: 1, duration: 220, useNativeDriver: true }).start(() => {
      hideTimer = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() =>
          onDone()
        );
      }, TOAST_MS);
    });

    return () => {
      if (hideTimer) clearTimeout(hideTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.id]);

  const accent = kindColor(payload.kind);

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [
          { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) },
        ],
        backgroundColor: "#18181B",
        borderRadius: 14,
        borderLeftWidth: 4,
        borderLeftColor: accent,
        paddingVertical: 12,
        paddingHorizontal: 14,
        marginBottom: 8,
        shadowColor: "#000",
        shadowOpacity: 0.25,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      }}
    >
      <Pressable onPress={onDone}>
        <Text style={{ color: accent, fontSize: 13, fontWeight: "700" }}>
          ⚠️ {payload.title}
        </Text>
        <Text style={{ color: "#FAFAFA", fontSize: 14, lineHeight: 20, marginTop: 3 }}>
          {payload.detail}
        </Text>
        {payload.meta ? (
          <Text style={{ color: "#A1A1AA", fontSize: 11, marginTop: 4 }}>{payload.meta}</Text>
        ) : null}
        <Text style={{ color: "#71717A", fontSize: 11, marginTop: 6 }}>
          แตะเพื่อปิด · ดูรายละเอียดที่ Settings → AI Diagnostics
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** Rendered once near the app root. Shows at most 3 at a time. */
export default function AiToastHost() {
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<AiToastPayload[]>([]);

  useEffect(
    () =>
      subscribeToasts((payload) => {
        setToasts((prev) => [payload, ...prev].slice(0, 3));
      }),
    []
  );

  if (toasts.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: insets.top + 8,
        left: 12,
        right: 12,
        zIndex: 9999,
      }}
    >
      {toasts.map((t) => (
        <Toast
          key={t.id}
          payload={t}
          onDone={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
        />
      ))}
    </View>
  );
}