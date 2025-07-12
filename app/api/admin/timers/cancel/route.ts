import { NextResponse, type NextRequest } from 'next/server';
import admin from 'firebase-admin';

// --- ส่วนเริ่มต้นการเชื่อมต่อ Firebase Admin SDK (สำหรับหลังบ้าน) ---
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (e) {
    console.error("Firebase Admin initialization error:", e);
  }
}
const db = admin.firestore();
// --- สิ้นสุดส่วนการเชื่อมต่อ ---

export async function POST(request: NextRequest) {
  try {
    const { timerId, storeId } = await request.json();

    if (!timerId || !storeId) {
      return NextResponse.json({ message: "Missing timerId or storeId" }, { status: 400 });
    }

    // Path to the specific timer document: stores/storeId/timers/timerId
    const timerRef = db
      .collection('stores')
      .doc(storeId)
      .collection('timers')
      .doc(timerId);

    await timerRef.update({
      status: 'cancelled', // เปลี่ยนสถานะเป็น 'cancelled'
      cancelled_at: admin.firestore.FieldValue.serverTimestamp(), // บันทึกเวลาที่ยกเลิก
    });

    return NextResponse.json({ message: `Timer ${timerId} cancelled successfully for store ${storeId}` });
  } catch (error) {
    console.error("Error cancelling timer:", error);
    return NextResponse.json({ message: "Failed to cancel timer." }, { status: 500 });
  }
}
