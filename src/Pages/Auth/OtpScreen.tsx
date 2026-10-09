import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';

export default function OtpScreen({ route, navigation }: any) {
  const { phone } = route?.params || { phone: '' };
  const [otp, setOtp] = useState('');

  const handleVerifyOtp = () => {
    // TODO: เรียก API ยืนยันรหัส OTP
    // จำลองการเช็คว่าเคยมีบัญชีหรือยัง
    const isExistingUser = false; // เปลี่ยนเป็น true เพื่อไปหน้า Home เลย

    if (isExistingUser) {
      navigation.navigate('HomeScreen'); // เข้าสู่ระบบสำเร็จ
    } else {
      navigation.navigate('RoleSelectionScreen'); // ไปหน้าเลือกประเภทบัญชีเพื่อสมัครสมาชิก
    }
  };

  const handleResendOtp = () => {
    // TODO: เรียก API ส่ง OTP อีกครั้ง
    console.log('Resend OTP');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>ยืนยันรหัส OTP</Text>
        <Text style={styles.subtitle}>รหัส 6 หลักถูกส่งไปยังเบอร์ {phone}</Text>
        
        <TextInput
          style={styles.input}
          placeholder="รหัส OTP 6 หลัก"
          keyboardType="number-pad"
          value={otp}
          onChangeText={setOtp}
          maxLength={6}
          textAlign="center"
        />

        <TouchableOpacity 
          style={[styles.button, otp.length === 6 ? styles.buttonActive : {}]} 
          onPress={handleVerifyOtp}
          disabled={otp.length !== 6}
        >
          <Text style={styles.buttonText}>ยืนยัน</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.resendButton} onPress={handleResendOtp}>
          <Text style={styles.resendText}>ขอรหัสอีกครั้ง</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FDFBF7' },
  content: { padding: 24, flex: 1, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#2D6A4F', marginBottom: 8, fontFamily: 'Mitr' },
  subtitle: { fontSize: 14, color: '#6B7280', marginBottom: 32, fontFamily: 'BaiJamjuree' },
  input: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 16, fontSize: 24, marginBottom: 24, backgroundColor: '#FFF', letterSpacing: 8 },
  button: { backgroundColor: '#E5E7EB', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonActive: { backgroundColor: '#2D6A4F' },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  resendButton: { marginTop: 24, alignItems: 'center' },
  resendText: { color: '#D47A3A', fontSize: 14, fontWeight: 'bold' }
});
