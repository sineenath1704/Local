import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';

export default function RoleSelectionScreen({ navigation }: any) {
  
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>คุณใช้งานแอปพลิเคชันในฐานะใด?</Text>
        <Text style={styles.subtitle}>เลือกประเภทบัญชีเพื่อเริ่มต้นใช้งาน Local</Text>
        
        <TouchableOpacity 
          style={styles.card} 
          onPress={() => navigation.navigate('TouristSetupScreen')}
        >
          <Text style={styles.cardTitle}>🎒 นักท่องเที่ยว</Text>
          <Text style={styles.cardDesc}>สำรวจชุมชน วางแผนทริป และแชร์ประสบการณ์ของคุณ</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.card, styles.cardCommunity]} 
          onPress={() => navigation.navigate('CommunitySetupScreen')}
        >
          <Text style={styles.cardTitle}>🏡 ชุมชน / ผู้ให้บริการ</Text>
          <Text style={styles.cardDesc}>วิสาหกิจชุมชน โฮมสเตย์ ร้านอาหาร เปิดรับนักท่องเที่ยว</Text>
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
  card: { backgroundColor: '#FFF', padding: 24, borderRadius: 16, marginBottom: 16, borderWidth: 1, borderColor: '#E5E7EB', shadowColor: '#2D6A4F', shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  cardCommunity: { borderColor: '#D47A3A' },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#1D3557', marginBottom: 8, fontFamily: 'Mitr' },
  cardDesc: { fontSize: 14, color: '#6B7280', fontFamily: 'BaiJamjuree', lineHeight: 20 }
});
