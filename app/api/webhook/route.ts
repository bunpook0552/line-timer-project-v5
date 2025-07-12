import { NextResponse, type NextRequest } from 'next/server';
import admin from 'firebase-admin';
import crypto from 'crypto';

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

// Interface และ Type ที่จำเป็น
interface QuickReplyAction {
  type: 'message';
  label: string;
  text: string;
}

interface QuickReplyItem {
  type: 'action';
  action: QuickReplyAction;
}

interface MessageTemplate {
  id: string;
  text: string;
}

interface LineEvent {
  type: string;
  replyToken: string;
  source: {
    userId?: string;
  };
  message: {
    type: string;
    text: string;
  };
}

// Global variable to cache message templates during a single request
const messageTemplatesMap = new Map<string, string>();

// ฟังก์ชันสำหรับดึงข้อความจาก Firebase Firestore
async function fetchMessagesFromFirestore(storeId: string): Promise<void> {
    messageTemplatesMap.clear();
    try {
        const templatesCol = db.collection('stores').doc(storeId).collection('message_templates');
        const snapshot = await templatesCol.get();
        if (snapshot.empty) {
            console.warn(`No message templates found for store ${storeId}.`);
        } else {
            snapshot.forEach(doc => {
                const data = doc.data() as MessageTemplate;
                if (data.id && data.text) {
                    messageTemplatesMap.set(data.id, data.text);
                }
            });
            console.log(`Fetched ${messageTemplatesMap.size} message templates from Firestore for store ${storeId}.`);
        }
    } catch (error) {
        console.error(`Error fetching message templates for store ${storeId}:`, error);
    }
}

// ฟังก์ชันสำหรับส่งข้อความตอบกลับ
async function replyMessage(replyToken: string, text: string, accessToken: string, quickReplyItems?: QuickReplyItem[]) {
  const replyUrl = 'https://api.line.me/v2/bot/message/reply';
  const messagePayload = {
    replyToken: replyToken,
    messages: [{
      type: 'text' as const,
      text: text,
      ...(quickReplyItems && quickReplyItems.length > 0 && { quickReply: { items: quickReplyItems } })
    }],
  };

  try {
    const response = await fetch(replyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(messagePayload),
    });
    if (!response.ok) {
        console.error("Failed to send reply message:", await response.text());
    }
  } catch (error) {
    console.error("Error in replyMessage fetch:", error);
  }
}

// ฟังก์ชันสำหรับเริ่มจับเวลา
async function startTimer(userId: string, storeId: string, machineType: 'washer' | 'dryer', machineId: number, duration: number, displayName: string, replyToken: string, accessToken: string) {
    const endTime = admin.firestore.Timestamp.fromDate(new Date(Date.now() + duration * 60 * 1000));
    const timersRef = db.collection('stores').doc(storeId).collection('timers');
    
    const existingTimersQuery = await timersRef
        .where('machine_id', '==', machineId)
        .where('machine_type', '==', machineType)
        .where('status', '==', 'pending')
        .get();

    if (!existingTimersQuery.empty) {
        const busyMessage = messageTemplatesMap.get('machine_busy') || 'เครื่อง {display_name} กำลังใช้งานอยู่ค่ะ';
        await replyMessage(replyToken, busyMessage.replace('{display_name}', displayName), accessToken);
        return;
    }

    await timersRef.add({
        user_id: userId,
        machine_id: machineId,
        machine_type: machineType,
        display_name: displayName,
        duration_minutes: duration,
        end_time: endTime,
        status: 'pending',
        created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    const confirmationMessage = messageTemplatesMap.get('start_timer_confirmation') || 'รับทราบค่ะ! เริ่มจับเวลา {duration} นาทีสำหรับ {display_name} แล้วค่ะ';
    await replyMessage(replyToken,
        confirmationMessage
            .replace('{duration}', String(duration))
            .replace('{display_name}', displayName),
        accessToken
    );
}

// --- Webhook Handler หลัก ---
export async function POST(request: NextRequest) {
  // ดึง storeId จาก URL parameter แบบไดนามิก
  const url = new URL(request.url);
  const storeId = url.searchParams.get('storeId');

  // ตรวจสอบว่ามี storeId ใน URL หรือไม่
  if (!storeId) {
    console.error("Webhook called without storeId parameter.");
    return new NextResponse("storeId parameter is missing", { status: 400 });
  }
  
  // ดึงข้อมูลร้านค้า (Store Data) จาก Firestore
  const storeRef = db.collection('stores').doc(storeId);
  const storeDoc = await storeRef.get();

  if (!storeDoc.exists) {
      console.error(`Store with ID "${storeId}" not found in Firestore.`);
      return new NextResponse("Store not found", { status: 404 });
  }
  
  const storeData = storeDoc.data()!;
  const channelSecret = storeData.line_channel_secret;
  const lineAccessToken = storeData.line_access_token;

  if (!channelSecret || !lineAccessToken) {
      console.error(`Line API keys are missing in Firestore for store: ${storeId}`);
      return new NextResponse("Line API keys missing in Firestore", { status: 500 });
  }
  
  // --- การตรวจสอบลายเซ็น (Signature Validation) ---
  try {
    const body = await request.text();
    const signature = request.headers.get('x-line-signature') || '';
    const hash = crypto.createHmac('sha256', channelSecret).update(body).digest('base64');

    if (hash !== signature) {
      console.error(`Signature validation failed for store: ${storeId}`);
      return new NextResponse("Signature validation failed!", { status: 401 });
    }

    // ดึงข้อความสำหรับร้านค้านี้
    await fetchMessagesFromFirestore(storeId);

    // ประมวลผล Events ที่ได้รับจาก LINE
    const events: LineEvent[] = JSON.parse(body).events;
    for (const event of events) {
        if (event.type === 'message' && event.message.type === 'text' && event.source.userId) {
            const userId = event.source.userId;
            const userMessage = event.message.text.trim().toLowerCase();
            const replyToken = event.replyToken;
            const machineConfigsCol = db.collection('stores').doc(storeId).collection('machine_configs');

            // Logic การตอบกลับตามข้อความ
            if (userMessage === "ซักผ้า") {
                const q = machineConfigsCol.where('machine_type', '==', 'washer').where('is_active', '==', true);
                const snapshot = await q.get();
                const buttons: QuickReplyItem[] = snapshot.docs.map(doc => ({
                    type: 'action', action: { type: 'message', label: `เครื่อง ${doc.data().machine_id}`, text: `ซักผ้า_เลือก_${doc.data().machine_id}` }
                }));
                const replyText = buttons.length > 0 ? 'กรุณาเลือกหมายเลขเครื่องซักผ้าค่ะ' : 'ขออภัยค่ะ ขณะนี้ไม่มีเครื่องซักผ้าว่าง';
                await replyMessage(replyToken, replyText, lineAccessToken, buttons);

            } else if (userMessage === "อบผ้า") {
                const q = machineConfigsCol.where('machine_type', '==', 'dryer').where('is_active', '==', true);
                const snapshot = await q.get();
                const buttons: QuickReplyItem[] = snapshot.docs.map(doc => ({
                    type: 'action', action: { type: 'message', label: `${doc.data().duration_minutes} นาที`, text: `อบผ้า_เลือก_${doc.data().machine_id}` }
                }));
                const replyText = buttons.length > 0 ? 'กรุณาเลือกเวลาสำหรับเครื่องอบผ้าค่ะ' : 'ขออภัยค่ะ ขณะนี้ไม่มีเครื่องอบผ้าว่าง';
                await replyMessage(replyToken, replyText, lineAccessToken, buttons);

            } else if (userMessage.startsWith("ซักผ้า_เลือก_") || userMessage.startsWith("อบผ้า_เลือก_")) {
                const parts = userMessage.split('_');
                const machineType = parts[0] === 'ซักผ้า' ? 'washer' : 'dryer';
                const requestedMachineId = parseInt(parts[2], 10);
                
                const q = machineConfigsCol.where('machine_id', '==', requestedMachineId).where('machine_type', '==', machineType).limit(1);
                const snapshot = await q.get();
                
                if (!snapshot.empty) {
                    const machineData = snapshot.docs[0].data();
                    if (machineData.is_active) {
                        await startTimer(userId, storeId, machineType, machineData.machine_id, machineData.duration_minutes, machineData.display_name, replyToken, lineAccessToken);
                    } else {
                        const inactiveMessage = messageTemplatesMap.get('machine_inactive') || 'เครื่อง {display_name} กำลังปิดใช้งานอยู่ค่ะ';
                        await replyMessage(replyToken, inactiveMessage.replace('{display_name}', machineData.display_name), lineAccessToken);
                    }
                } else {
                    await replyMessage(replyToken, messageTemplatesMap.get('machine_not_found') || 'ไม่พบหมายเลขเครื่องที่คุณระบุ', lineAccessToken);
                }
            } else {
                const initialButtons: QuickReplyItem[] = [
                    { type: 'action', action: { type: 'message', label: 'ซักผ้า', text: 'ซักผ้า' } },
                    { type: 'action', action: { type: 'message', label: 'อบผ้า', text: 'อบผ้า' } }
                ];
                await replyMessage(replyToken, messageTemplatesMap.get('initial_greeting') || 'สวัสดีค่ะ กรุณาเลือกบริการ', lineAccessToken, initialButtons);
            }
        }
    }
    return NextResponse.json({ status: "ok" });
    
  } catch (error: unknown) {
    console.error("Error in webhook handler:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}