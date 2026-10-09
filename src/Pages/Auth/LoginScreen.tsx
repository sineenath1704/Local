import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';

export default function LoginScreen({ navigation }: any) {
  const [phone, setPhone] = useState('');

  const handleSendOtp = () => {
    // TODO: เรียก API เช็คเบอร์โทร และส่ง OTP
    // ส่งเบอร์โทรไปหน้า OTP ด้วย
    navigation.navigate('OtpScreen', { phone });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>เข้าสู่ระบบ / ลงทะเบียน</Text>
        <Text style={styles.subtitle}>กรุณากรอกเบอร์โทรศัพท์เพื่อรับรหัส OTP</Text>
        
        <TextInput
          style={styles.input}
          placeholder="08X-XXX-XXXX"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          maxLength={10}
        />

        <TouchableOpacity 
          style={[styles.button, phone.length === 10 ? styles.buttonActive : {}]} 
          onPress={handleSendOtp}
          disabled={phone.length !== 10}
        >
          <Text style={styles.buttonText}>ดำเนินการต่อ</Text>
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
  input: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 16, fontSize: 16, marginBottom: 24, backgroundColor: '#FFF' },
  button: { backgroundColor: '#E5E7EB', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonActive: { backgroundColor: '#2D6A4F' },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold', fontFamily: 'BaiJamjuree' }
});
