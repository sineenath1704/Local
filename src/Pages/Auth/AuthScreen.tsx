import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../state/AuthContext";

/**
 * Google sign-in screen. One tap → Supabase OAuth via in-app browser.
 */
export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { configured, signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogle = async () => {
    setError(null);
    setBusy(true);
    const { error } = await signInWithGoogle();
    setBusy(false);
    if (error) setError(error);
    // On success, AuthContext's onAuthStateChange swaps to the main app.
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.content}>
        <View style={styles.brand}>
          <Text style={styles.logo}>Local</Text>
          <View style={styles.dot} />
        </View>
        <Text style={styles.tagline}>เที่ยวชุมชน • วิถีไทย • OTOP</Text>

        {!configured && (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>
              ยังไม่ได้ตั้งค่า Supabase (.env) — เข้าสู่ระบบจะยังใช้งานไม่ได้
            </Text>
          </View>
        )}

        <Text style={styles.title}>ยินดีต้อนรับสู่ Local</Text>
        <Text style={styles.subtitle}>เข้าสู่ระบบเพื่อเริ่มสำรวจและแชร์ชุมชนท่องเที่ยว</Text>

        <TouchableOpacity
          style={styles.googleBtn}
          onPress={handleGoogle}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator color="#1F2937" />
          ) : (
            <>
              <Image
                source={{ uri: "https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" }}
                style={styles.googleIcon}
              />
              <Text style={styles.googleText}>เข้าสู่ระบบด้วย Google</Text>
            </>
          )}
        </TouchableOpacity>

        {error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.terms}>
          การเข้าสู่ระบบถือว่ายอมรับเงื่อนไขการใช้งานและนโยบายความเป็นส่วนตัว
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FDFBF7" },
  content: { padding: 24, flex: 1, justifyContent: "center" },
  brand: { flexDirection: "row", alignItems: "flex-end", alignSelf: "center" },
  logo: { fontSize: 44, fontWeight: "900", color: "#1B4332", letterSpacing: -1 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#00D26A", marginLeft: 4, marginBottom: 9 },
  tagline: { textAlign: "center", color: "#6B7280", marginTop: 4, marginBottom: 48, fontSize: 13 },
  title: { fontSize: 22, fontWeight: "bold", color: "#2D6A4F", marginBottom: 6, textAlign: "center" },
  subtitle: { fontSize: 14, color: "#6B7280", marginBottom: 32, textAlign: "center", lineHeight: 20 },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingVertical: 15,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  googleIcon: { width: 20, height: 20, marginRight: 10 },
  googleText: { fontSize: 16, fontWeight: "bold", color: "#1F2937" },
  error: { color: "#DC2626", fontSize: 13, marginTop: 16, textAlign: "center" },
  terms: { color: "#9CA3AF", fontSize: 11, textAlign: "center", marginTop: 28, lineHeight: 16 },
  warnBox: { backgroundColor: "#FEF3C7", borderColor: "#FDE68A", borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 24 },
  warnText: { color: "#92400E", fontSize: 12, lineHeight: 18, textAlign: "center" },
});
