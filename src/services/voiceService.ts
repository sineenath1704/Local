import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
} from "expo-audio";

/**
 * voiceService — ห่อ expo-audio ไว้ที่ไฟล์เดียว
 * -------------------------------------------------------------
 * ทั้งแอปมีแค่นี้ที่แตะ expo-audio → ถ้า API เปลี่ยนในอนาคต แก้ที่ไฟล์เดียว
 *
 * หน้าจอ (TranslateScreen) เรียกแค่ 3 ฟังก์ชันนี้:
 *   requestMicPermission()          → ขอสิทธิ์ไมโครโฟน
 *   startRecording(recorder)        → เริ่มอัด
 *   stopRecording(recorder)         → หยุดอัด ได้ { uri, mimeType } กลับไปส่ง backend
 *
 * ตัว recorder มาจาก hook `useAudioRecorder()` ของ expo-audio
 * (SDK 58 ไม่ได้ export คลาส AudioRecorder ให้สร้างเองได้ — ต้องใช้ hook
 *  ที่จัดการปล่อย native object เมื่อหน้าจอปิด)
 */

/**
 * ขอสิทธิ์เข้าถึงไมโครโฟน
 * คืน false = ผู้ใช้ไม่อนุญาต (หน้าจอจะขึ้น Alert อธิบายวิธีเปิดสิทธิ์)
 */
export async function requestMicPermission(): Promise<boolean> {
  try {
    const res = await requestRecordingPermissionsAsync();
    return res.granted === true;
  } catch {
    return false;
  }
}

/**
 * เริ่มอัดเสียง
 * - setAudioModeAsync: เปิดโหมดให้อัดได้แม้อยู่ใน silent mode
 * - prepareToRecordAsync: เตรียมไฟล์ (ครั้งแรกจะขอสิทธิ์ไมโครโฟนด้วย)
 */
export async function startRecording(recorder: AudioRecorder): Promise<void> {
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
  });
  await recorder.prepareToRecordAsync();
  recorder.record();
}

/** หยุดอัดเสียง → ได้พาธไฟล์ + ชนิดไฟล์ไปส่ง backend */
export async function stopRecording(recorder: AudioRecorder): Promise<{
  uri: string;
  mimeType: string;
}> {
  await recorder.stop();
  const uri = recorder.uri;
  if (!uri) {
    throw new Error("อัดเสียงไม่สำเร็จ — ลองอีกครั้ง");
  }
  return { uri, mimeType: mimeFromUri(uri) };
}

/** เดา mime type จากนามสกุลไฟล์ (ค่าที่ backend รับได้) */
function mimeFromUri(uri: string): string {
  const ext = uri.split("?")[0].match(/\.(\w+)$/)?.[1]?.toLowerCase();
  switch (ext) {
    case "m4a":
      return "audio/m4a";
    case "aac":
      return "audio/aac";
    case "wav":
      return "audio/wav";
    case "caf":
      return "audio/x-caf";
    case "mp3":
      return "audio/mpeg";
    default:
      return "audio/mp4";
  }
}
