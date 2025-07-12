import { NextResponse } from 'next/server';
import admin from 'firebase-admin';

// --- ส่วนเริ่มต้นการเชื่อมต่อ Firebase Admin SDK (สำหรับหลังบ้าน) ---
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (e: unknown) {
    console.error("Firebase Admin initialization error", e);
  }
}
const db = admin.firestore();
// --- สิ้นสุดส่วนการเชื่อมต่อ ---

// === กำหนด ID ร้านค้า (สำหรับร้านแรก) ===
const STORE_ID = 'laundry_1'; 

export async function GET() {
  console.log("Cron job started...");
  try {
    const now = new Date();
    // 1. ค้นหา Timers ทั้งหมดที่ครบกำหนดเวลาแล้ว และยังไม่ได้ส่งข้อความ
    // Path to timers: stores/STORE_ID/timers
    const querySnapshot = await db.collection('stores').doc(STORE_ID).collection('timers')
      .where('status', '==', 'pending')
      .where('end_time', '<=', now)
      .get();

    if (querySnapshot.empty) {
      console.log("No pending timers found.");
      return NextResponse.json({ message: "No pending timers found." });
    }

    const pushMessageUrl = 'https://api.line.me/v2/bot/message/push';
    const accessToken = process.env.LINE_MESSAGING_TOKEN;

    if (!accessToken) {
        console.error("LINE_MESSAGING_TOKEN is not set.");
        return NextResponse.json({ message: "LINE_MESSAGING_TOKEN missing." }, { status: 500 });
    }

    // 2. ววนลูปส่งข้อความสำหรับทุกรายการที่เจอ
    for (const doc of querySnapshot.docs) {
      const timer = doc.data();
      const userId = timer.user_id;
      // FIX: Removed unused variable 'machineType' to resolve the build error.
      const displayName = timer.display_name;
      const durationMinutes = timer.duration_minutes;

      // === ดึงข้อความแจ้งเตือนจาก Firebase (message_templates) ===
      const messageTemplatesCol = db.collection('stores').doc(STORE_ID).collection('message_templates');
      const notificationTemplateDoc = await messageTemplatesCol.where('id', '==', 'timer_completed_notification').limit(1).get();
      
      let notificationText = '🔔 แจ้งเตือน! ✅\nเครื่องของคุณซักเสร็จเรียบร้อยแล้วค่ะ'; // Fallback message
      if (!notificationTemplateDoc.empty) {
          notificationText = notificationTemplateDoc.docs[0].data().text;
          // แทนที่ {display_name} และ {duration_minutes}
          notificationText = notificationText.replace('{display_name}', displayName || 'เครื่องของคุณ');
          notificationText = notificationText.replace('{duration_minutes}', String(durationMinutes) || '');
      }

      const message = {
        to: userId,
        messages: [
          {
            type: 'text',
            text: notificationText,
          },
        ],
      };

      // 3. ส่ง Push Message ผ่าน Messaging API
      const response = await fetch(pushMessageUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(message),
      });

      if (response.ok) {
        console.log(`Successfully sent notification to user ${userId} for ${displayName}`);
        // 4. อัปเดตสถานะในฐานข้อมูลเป็น 'sent' เพื่อไม่ให้ส่งซ้ำ
        await doc.ref.update({ status: 'sent' });
      } else {
        const errorResult = await response.json();
        console.error(`Failed to send notification to user ${userId} for ${displayName}:`, errorResult);
      }
    }

    return NextResponse.json({ message: "Cron job executed successfully." });
  } catch (error) {
    console.error("Error executing cron job:", error);
    return NextResponse.json({ message: "Error executing cron job." }, { status: 500 });
  }
}