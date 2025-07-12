import { NextResponse, type NextRequest } from 'next/server';
import admin from 'firebase-admin';
import crypto from 'crypto';

// --- ส่วนเริ่มต้นการเชื่อมต่อ Firebase Admin SDK (สำหรับหลังบ้าน) ---
// เราจะยังใช้ FIREBASE_SERVICE_ACCOUNT จาก Environment Variables สำหรับ Admin SDK
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
// หากต้องการรองรับหลายร้านค้าในอนาคต เราจะต้องดึง STORE_ID จาก Request
// แต่เนื่องจากโค้ดเดิมของคุณกำหนดไว้ตายตัว เราจึงใช้ค่านี้ในการดึง Line API Keys จาก Firestore
// หากต้องการให้บอทรองรับหลายร้านค้าในอนาคตโดยไม่ต้องแก้โค้ดนี้ จะต้องมีการปรับโครงสร้างให้ดึง STORE_ID แบบไดนามิก (เช่นจาก URL หรือ Line Source)
const STORE_ID = 'laundry_5';

// กำหนด Type สำหรับ Quick Reply Item เพื่อความถูกต้องของ TypeScript
interface QuickReplyAction {
  type: 'message';
  label: string;
  text: string;
}

interface QuickReplyItem {
  type: 'action';
  action: QuickReplyAction;
}

// --- Type for Message Templates from Firestore ---
interface MessageTemplate {
  id: string; // The custom ID like 'initial_greeting'
  text: string;
}

// ===================================================================================
// START: CODE FIX AREA
// ===================================================================================
// สร้าง Interface สำหรับ LINE Event เพื่อหลีกเลี่ยงการใช้ 'any'
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
// ===================================================================================
// END: CODE FIX AREA
// ===================================================================================


// --- Global variable to store fetched messages ---
const messageTemplatesMap = new Map<string, string>();


// ฟังก์ชันสำหรับดึงข้อความจาก Firebase Firestore
async function fetchMessagesFromFirestore(storeId: string): Promise<void> {
    
    // ล้างค่าเก่าและดึงใหม่เสมอเพื่อให้ได้ข้อมูลล่าสุด
    messageTemplatesMap.clear();

    try {
        const templatesCol = db.collection('stores').doc(storeId).collection('message_templates');
        const snapshot = await templatesCol.get();
        if (snapshot.empty) {
            console.warn(`No message templates found for store ${storeId}. Using default fallbacks.`);
            // Fallback to basic default messages if nothing found in DB
            messageTemplatesMap.set('initial_greeting', 'สวัสดีค่ะ ร้านซัก-อบ ยินดีต้อนรับ 🙏\n\nกรุณาเลือกบริการที่ต้องการค่ะ');
            messageTemplatesMap.set('start_timer_confirmation', 'รับทราบค่ะ! ✅\nเริ่มจับเวลา {duration} นาทีสำหรับ {display_name} แล้วค่ะ');
            messageTemplatesMap.set('machine_busy', 'ขออภัยค่ะ 🙏\nเครื่อง {display_name} กำลังใช้งานอยู่ค่ะ');
            messageTemplatesMap.set('machine_inactive', 'ขออภัยค่ะ 🙏\nเครื่อง {display_name} กำลังปิดใช้งานอยู่ค่ะ');
            messageTemplatesMap.set('machine_not_found', 'ขออภัยค่ะ ไม่พบหมายเลขเครื่องที่คุณระบุ กรุณาพิมพ์เฉพาะตัวเลขของเครื่องที่เปิดใช้งานค่ะ');
            messageTemplatesMap.set('non_text_message', 'ขออภัยค่ะ บอทเข้าใจเฉพาะข้อความตัวอักษรเท่านั้น');
            messageTemplatesMap.set('contact_message', 'ขออภัยค่ะ บอทสามารถตั้งเวลาได้จากตัวเลขของเครื่องเท่านั้นค่ะ 🙏\n\nหากต้องการติดต่อเจ้าหน้าที่โดยตรง กรุณาติดต่อที่:\nโทร: 08x-xxx-xxxx\nหรือที่หน้าเคาน์เตอร์ได้เลยค่ะ');
            messageTemplatesMap.set('generic_error', 'ขออภัยค่ะ เกิดข้อผิดพลาดทางเทคนิค กรุณาลองใหม่อีกครั้ง');
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
        console.error("Error fetching message templates from Firestore:", error);
        // Ensure basic fallbacks are set even if fetch fails
        if (messageTemplatesMap.size === 0) {
            messageTemplatesMap.set('initial_greeting', 'สวัสดีค่ะ ร้านซัก-อบ ยินดีต้อนรับ 🙏\n\nกรุณาเลือกบริการที่ต้องการค่ะ');
            messageTemplatesMap.set('start_timer_confirmation', 'รับทราบค่ะ! ✅\nเริ่มจับเวลา {duration} นาทีสำหรับ {display_name} แล้วค่ะ');
            messageTemplatesMap.set('machine_busy', 'ขออภัยค่ะ 🙏\nเครื่อง {display_name} กำลังใช้งานอยู่ค่ะ');
            messageTemplatesMap.set('machine_inactive', 'ขออภัยค่ะ 🙏\nเครื่อง {display_name} กำลังปิดใช้งานอยู่ค่ะ');
            messageTemplatesMap.set('machine_not_found', 'ขออภัยค่ะ ไม่พบหมายเลขเครื่องที่คุณระบุ กรุณาพิมพ์เฉพาะตัวเลขของเครื่องที่เปิดใช้งานค่ะ');
            messageTemplatesMap.set('non_text_message', 'ขออภัยค่ะ บอทเข้าใจเฉพาะข้อความตัวอักษรเท่านั้น');
            messageTemplatesMap.set('contact_message', 'ขออภัยค่ะ บอทสามารถตั้งเวลาได้จากตัวเลขของเครื่องเท่านั้นค่ะ 🙏\n\nหากต้องการติดต่อเจ้าหน้าที่โดยตรง กรุณาติดต่อที่:\nโทร: 08x-xxx-xxxx\nหรือที่หน้าเคาน์เตอร์ได้เลยค่ะ');
            messageTemplatesMap.set('generic_error', 'ขออภัยค่ะ เกิดข้อผิดพลาดทางเทคนิค กรุณาลองใหม่อีกครั้ง');
        }
    }
}


// ฟังก์ชันสำหรับส่งข้อความตอบกลับพร้อมปุ่ม Quick Reply
// แก้ไข: เพิ่ม accessToken เป็น parameter
async function replyMessage(replyToken: string, text: string, accessToken: string, quickReplyItems?: QuickReplyItem[]) {
  const replyUrl = 'https://api.line.me/v2/bot/message/reply';

  const messagePayload: {
    replyToken: string;
    messages: Array<{
      type: 'text';
      text: string;
      quickReply?: { items: QuickReplyItem[] };
    }>;
  } = {
    replyToken: replyToken,
    messages: [{ type: 'text', text: text }],
  };
  if (quickReplyItems && quickReplyItems.length > 0) {
    messagePayload.messages[0].quickReply = { items: quickReplyItems };
  }

  const response = await fetch(replyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`, // ใช้ accessToken ที่ส่งมา
    },
    body: JSON.stringify(messagePayload),
  });
  if (!response.ok) {
    console.error("Failed to send reply message:", await response.json());
  }
}

// ฟังก์ชันสำหรับเริ่มจับเวลาและบันทึกลง DB
// แก้ไข: เพิ่ม accessToken เป็น parameter
async function startTimer(userId: string, storeId: string, machineType: 'washer' | 'dryer', machineId: number, duration: number, displayName: string, replyToken: string, accessToken: string) {
    const endTime = new Date(Date.now() + duration * 60 * 1000);

    const existingTimersQuery = await db.collection('stores').doc(storeId).collection('timers')
        .where('machine_id', '==', machineId)
        .where('machine_type', '==', machineType)
        .where('status', '==', 'pending')
        .get(); 

    if (!existingTimersQuery.empty) {
        const busyMessage = messageTemplatesMap.get('machine_busy') || 'เครื่อง {display_name} กำลังใช้งานอยู่ค่ะ';
        await replyMessage(replyToken, busyMessage.replace('{display_name}', displayName), accessToken);
        return;
    }

    await db.collection('stores').doc(storeId).collection('timers').add({
        user_id: userId,
        machine_id: machineId,
        machine_type: machineType, 
        display_name: displayName, 
        duration_minutes: duration, 
        end_time: admin.firestore.Timestamp.fromDate(endTime),
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

// แก้ไข: โค้ดส่วน POST function เพื่อดึง Line API Keys จาก Firebase
export async function POST(request: NextRequest) {
  let events: LineEvent[] = [];

  try {
    // ดึงข้อมูลข้อความจาก Firestore โดยใช้ STORE_ID ที่กำหนดไว้
    await fetchMessagesFromFirestore(STORE_ID);

    const body = await request.text();
    const signature = request.headers.get('x-line-signature') || '';

    // *** ดึงข้อมูลร้านค้าจาก Firebase เพื่อให้ได้ Line API Keys ***
    const storeRef = db.collection('stores').doc(STORE_ID);
    const storeDoc = await storeRef.get();

    if (!storeDoc.exists) {
        console.error(`Store ${STORE_ID} not found in Firestore.`);
        return new NextResponse("Store not found", { status: 404 });
    }
    
    const storeData = storeDoc.data();
    // ดึง channelSecret และ lineAccessToken จาก Firebase (ไม่ใช่จาก Environment Variables)
    const channelSecret = storeData?.line_channel_secret; 
    const lineAccessToken = storeData?.line_access_token; 

    if (!channelSecret || !lineAccessToken) {
        console.error("Line API keys missing in Firestore for store:", STORE_ID);
        return new NextResponse("Line API keys missing in Firestore", { status: 500 });
    }

    // *** ตรวจสอบลายเซ็นด้วย channelSecret ที่ดึงมาจาก Firebase ***
    const hash = crypto.createHmac('sha256', channelSecret).update(body).digest('base64');
    if (hash !== signature) {
      return new NextResponse("Signature validation failed!", { status: 401 });
    }

    events = JSON.parse(body).events; 
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text' && event.source.userId) {
        const userId = event.source.userId; 
        const userMessage = event.message.text.trim().toLowerCase();
        const replyToken = event.replyToken; 

        if (userMessage === "ซักผ้า") {
            const machineConfigsCol = db.collection('stores').doc(STORE_ID).collection('machine_configs');
            const q = machineConfigsCol.where('machine_type', '==', 'washer').where('is_active', '==', true);
            const machineSnapshot = await q.get();

            const washerButtons: QuickReplyItem[] = machineSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    type: 'action',
                    action: { type: 'message', label: `เครื่อง ${data.machine_id}`, text: `ซักผ้า_เลือก_${data.machine_id}` }
                };
            });

            if (washerButtons.length > 0) {
                // แก้ไข: ส่ง lineAccessToken ไปด้วย
                await replyMessage(replyToken, 'กรุณาเลือกหมายเลขเครื่องซักผ้าค่ะ', lineAccessToken, washerButtons);
            } else {
                // แก้ไข: ส่ง lineAccessToken ไปด้วย
                await replyMessage(replyToken, 'ขออภัยค่ะ ขณะนี้ไม่มีเครื่องซักผ้าว่าง', lineAccessToken);
            }

        } else if (userMessage === "อบผ้า") {
            const machineConfigsCol = db.collection('stores').doc(STORE_ID).collection('machine_configs');
            const q = machineConfigsCol.where('machine_type', '==', 'dryer').where('is_active', '==', true);
            const machineSnapshot = await q.get();

            const dryerButtons: QuickReplyItem[] = machineSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    type: 'action',
                    action: { type: 'message', label: `${data.duration_minutes} นาที`, text: `อบผ้า_เลือก_${data.machine_id}` }
                };
            });

            if (dryerButtons.length > 0) {
                // แก้ไข: ส่ง lineAccessToken ไปด้วย
                await replyMessage(replyToken, 'กรุณาเลือกเวลาสำหรับเครื่องอบผ้าค่ะ', lineAccessToken, dryerButtons);
            } else {
                // แก้ไข: ส่ง lineAccessToken ไปด้วย
                await replyMessage(replyToken, 'ขออภัยค่ะ ขณะนี้ไม่มีเครื่องอบผ้าว่าง', lineAccessToken);
            }
        } 
        else if (userMessage.startsWith("ซักผ้า_เลือก_")) {
            const requestedMachineId = parseInt(userMessage.replace('ซักผ้า_เลือก_', ''), 10);
            if (!isNaN(requestedMachineId)) {
                const machineConfigsCol = db.collection('stores').doc(STORE_ID).collection('machine_configs');
                const q = machineConfigsCol.where('machine_id', '==', requestedMachineId).where('machine_type', '==', 'washer').limit(1);
                const machineSnapshot = await q.get();

                if (!machineSnapshot.empty) {
                    const machineConfigData = machineSnapshot.docs[0].data();
                    if (machineConfigData.is_active) {
                        // แก้ไข: ส่ง lineAccessToken ไปด้วย
                        await startTimer(userId, STORE_ID, 'washer', machineConfigData.machine_id, machineConfigData.duration_minutes, machineConfigData.display_name, replyToken, lineAccessToken);
                    } else {
                        const inactiveMessage = messageTemplatesMap.get('machine_inactive') || 'เครื่อง {display_name} กำลังปิดใช้งานอยู่ค่ะ';
                        // แก้ไข: ส่ง lineAccessToken ไปด้วย
                        await replyMessage(replyToken, inactiveMessage.replace('{display_name}', machineConfigData.display_name), lineAccessToken);
                    }
                } else {
                    // แก้ไข: ส่ง lineAccessToken ไปด้วย
                    await replyMessage(replyToken, messageTemplatesMap.get('machine_not_found') || 'ไม่พบหมายเลขเครื่องซักผ้า', lineAccessToken);
                }
            } else {
                // แก้ไข: ส่ง lineAccessToken ไปด้วย
                await replyMessage(replyToken, messageTemplatesMap.get('machine_not_found') || 'ข้อมูลหมายเลขเครื่องซักผ้าไม่ถูกต้อง', lineAccessToken);
            }
        } else if (userMessage.startsWith("อบผ้า_เลือก_")) {
            const requestedMachineId = parseInt(userMessage.replace('อบผ้า_เลือก_', ''), 10);
            if (!isNaN(requestedMachineId)) {
                const machineConfigsCol = db.collection('stores').doc(STORE_ID).collection('machine_configs');
                const q = machineConfigsCol.where('machine_id', '==', requestedMachineId).where('machine_type', '==', 'dryer').limit(1);
                const machineSnapshot = await q.get();

                if (!machineSnapshot.empty) {
                    const machineConfigData = machineSnapshot.docs[0].data();
                    if (machineConfigData.is_active) {
                        // แก้ไข: ส่ง lineAccessToken ไปด้วย
                        await startTimer(userId, STORE_ID, 'dryer', machineConfigData.machine_id, machineConfigData.duration_minutes, machineConfigData.display_name, replyToken, lineAccessToken);
                    } else {
                        const inactiveMessage = messageTemplatesMap.get('machine_inactive') || 'เครื่อง {display_name} กำลังปิดใช้งานอยู่ค่ะ';
                        // แก้ไข: ส่ง lineAccessToken ไปด้วย
                        await replyMessage(replyToken, inactiveMessage.replace('{display_name}', machineConfigData.display_name), lineAccessToken);
                    }
                } else {
                    // แก้ไข: ส่ง lineAccessToken ไปด้วย
                    await replyMessage(replyToken, messageTemplatesMap.get('machine_not_found') || 'ไม่พบเครื่องอบผ้า', lineAccessToken);
                }
            } else {
                // แก้ไข: ส่ง lineAccessToken ไปด้วย
                await replyMessage(replyToken, messageTemplatesMap.get('machine_not_found') || 'ข้อมูลเครื่องอบผ้าไม่ถูกต้อง', lineAccessToken);
            }
        }
        else {
            const initialButtons: QuickReplyItem[] = [
                { type: 'action', action: { type: 'message', label: 'ซักผ้า', text: 'ซักผ้า' } },
                { type: 'action', action: { type: 'message', label: 'อบผ้า', text: 'อบผ้า' } }
            ];
            // แก้ไข: ส่ง lineAccessToken ไปด้วย
            await replyMessage(replyToken, messageTemplatesMap.get('initial_greeting') || 'สวัสดีค่ะ กรุณาเลือกบริการที่ต้องการค่ะ', lineAccessToken, initialButtons);
        }
      } else {
        if (event.replyToken) {
            // แก้ไข: ส่ง lineAccessToken ไปด้วย
            await replyMessage(event.replyToken, messageTemplatesMap.get('non_text_message') || 'ขออภัยค่ะ บอทเข้าใจเฉพาะข้อความตัวอักษรเท่านั้น', lineAccessToken);
        }
      }
    }
    return NextResponse.json({ status: "ok" });
  } catch (error: unknown) {
    console.error("Error in webhook handler:", error);
    
    const fallbackReplyToken = events?.[0]?.replyToken;
    
    if (fallbackReplyToken) {
        // แก้ไข: หากเกิดข้อผิดพลาดในการประมวลผล เราไม่สามารถตอบกลับได้ถ้าไม่แน่ใจว่า lineAccessToken มีค่า
        // สำหรับตอนนี้ เราจะส่งข้อความ Error กลับไปโดยไม่ต้องใช้ lineAccessToken ในกรณีนี้
        return new NextResponse("Internal Server Error", { status: 500 });
    }
    
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}