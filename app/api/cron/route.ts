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


export async function GET() {
  console.log("Cron job started for all stores...");
  try {
    const now = new Date();
    const pushMessageUrl = 'https://api.line.me/v2/bot/message/push';

    // 1. ดึงรายชื่อร้านค้าทั้งหมด
    const storesSnapshot = await db.collection('stores').get();

    if (storesSnapshot.empty) {
      console.log("No stores found.");
      return NextResponse.json({ message: "No stores found." });
    }

    // 2. วนลูปแต่ละร้านค้าเพื่อตรวจสอบ Timers
    for (const storeDoc of storesSnapshot.docs) {
      const storeId = storeDoc.id;
      const storeData = storeDoc.data();
      const accessToken = storeData.line_access_token; // ดึง Token ของแต่ละร้าน

      if (!accessToken) {
        console.error(`LINE_MESSAGING_TOKEN is not set for store: ${storeId}`);
        continue; // ข้ามไปร้านถัดไปถ้าไม่มี Token
      }

      console.log(`Checking timers for store: ${storeId}`);

      // 3. ค้นหา Timers ที่ครบกำหนดในแต่ละร้าน
      const timersQuerySnapshot = await db.collection('stores').doc(storeId).collection('timers')
        .where('status', '==', 'pending')
        .where('end_time', '<=', now)
        .get();

      if (timersQuerySnapshot.empty) {
        console.log(`No pending timers found for store: ${storeId}.`);
        continue; // ไปยังร้านถัดไป
      }
      
      const messageTemplateDoc = await db.collection('stores').doc(storeId).collection('message_templates')
        .where('id', '==', 'timer_completed_notification').limit(1).get();
        
      const fallbackMessage = '🔔 แจ้งเตือน! ✅\n{display_name} ของคุณเสร็จเรียบร้อยแล้วค่ะ';
      const notificationTemplate = messageTemplateDoc.empty ? fallbackMessage : messageTemplateDoc.docs[0].data().text;

      // 4. วนลูปส่งข้อความสำหรับทุกรายการที่เจอในร้านนั้นๆ
      for (const timerDoc of timersQuerySnapshot.docs) {
        const timer = timerDoc.data();
        const userId = timer.user_id;
        const displayName = timer.display_name;
        
        const messageText = notificationTemplate.replace('{display_name}', displayName || 'เครื่องของคุณ');

        const message = {
          to: userId,
          messages: [{ type: 'text', text: messageText }],
        };

        const response = await fetch(pushMessageUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify(message),
        });

        if (response.ok) {
          console.log(`Successfully sent notification to user ${userId} for ${displayName} in store ${storeId}`);
          await timerDoc.ref.update({ status: 'sent' });
        } else {
          const errorResult = await response.json();
          console.error(`Failed to send notification to ${userId} for store ${storeId}:`, errorResult);
        }
      }
    }

    return NextResponse.json({ message: "Cron job executed successfully for all stores." });

  } catch (error) {
    console.error("Error executing cron job:", error);
    return NextResponse.json({ message: "Error executing cron job." }, { status: 500 });
  }
}