// app/api/create-store/route.js

import admin from 'firebase-admin'; // <--- แก้ไข: เปลี่ยน require เป็น import

// ตรวจสอบว่า Firebase Admin SDK ได้ถูก initialize หรือยัง
// นี่เป็นสิ่งสำคัญเพื่อให้มั่นใจว่าเรา initialize เพียงครั้งเดียวเท่านั้น
if (!admin.apps.length) {
  // ดึงค่า Service Account Key จาก Environment Variable
  // ซึ่งเราจะตั้งค่าใน Vercel ในขั้นตอนถัดไป
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!serviceAccountJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY or FIREBASE_SERVICE_ACCOUNT environment variable is not set.');
    // ควรส่ง Error ไปยัง client หรือจัดการ Error นี้อย่างเหมาะสม
    throw new Error('Server configuration error: Firebase service account key missing.');
  }

  // แปลง JSON string ให้เป็น Object
  const serviceAccount = JSON.parse(serviceAccountJson);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const auth = admin.auth();

// <--- แก้ไข: เปลี่ยน module.exports เป็น export async function POST(req)
export async function POST(req) {
  // รับข้อมูลจาก Body ของ Request โดยใช้ req.json() แทน req.body
  const { name, lineChannelId, lineChannelSecret, lineAccessToken, adminEmail, tempPassword } = await req.json(); // <--- แก้ไข: ใช้ await req.json() แทน req.body

  try {
    // ตรวจสอบว่าข้อมูลที่จำเป็นครบถ้วนหรือไม่
    if (!name || !lineChannelId || !lineChannelSecret || !lineAccessToken || !adminEmail || !tempPassword) {
      // <--- แก้ไข: ปรับการส่ง Response โดยใช้ new Response
      return new Response(JSON.stringify({ message: 'Missing required fields. Please provide name, lineChannelId, lineChannelSecret, lineAccessToken, adminEmail, and tempPassword.' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    // --- ขั้นตอนที่ 1: สร้าง User ใน Firebase Authentication ก่อน ---
    // เราจะสร้าง User ก่อน เพื่อให้มี UID สำหรับอ้างอิง
    let userRecord;
    try {
      userRecord = await auth.createUser({
        email: adminEmail,
        password: tempPassword,
        emailVerified: true // ตั้งให้เป็น true เพื่อให้ Login ได้ทันที หรือตั้งเป็น false เพื่อให้ผู้ใช้ต้องยืนยันอีเมลก่อน
      });
      console.log(`Successfully created new user: ${userRecord.uid}`);
    } catch (authError) {
      if (authError.code === 'auth/email-already-in-use') {
        // หากอีเมลนี้เคยถูกสร้างไว้แล้ว เราจะพยายามดึง User เดิมมาใช้
        console.warn(`User with email ${adminEmail} already exists. Attempting to get existing user.`);
        userRecord = await auth.getUserByEmail(adminEmail);
      } else {
        throw authError; // ถ้าเป็น Error อื่นๆ ให้โยนต่อ
      }
    }

    // --- ขั้นตอนที่ 2: สร้าง Document ร้านค้าใน Firestore ---
    // เราจะใช้ .add() เพื่อให้ Firestore สร้าง Document ID ให้อัตโนมัติ (เป็น UUID)
    const newStoreRef = await db.collection('stores').add({
      name: name,
      lineChannelId: lineChannelId,
      lineChannelSecret: lineChannelSecret,
      lineAccessToken: lineAccessToken,
      adminEmails: [adminEmail], // ผู้ดูแลหลักคนแรกของร้านนี้
      createdAt: admin.firestore.FieldValue.serverTimestamp(), // บันทึกเวลาที่สร้าง
    });
    console.log(`Successfully created new store: ${newStoreRef.id}`);

    // --- ขั้นตอนที่ 3: (Optional) สร้าง Sub-collections เริ่มต้น ---
    // คุณสามารถเพิ่มข้อมูลเริ่มต้นสำหรับ machine_configs และ message_templates ได้ที่นี่
    // ข้อมูลนี้จะถูกคัดลอกไปทุกร้านค้าใหม่ที่ถูกสร้าง

    // ตัวอย่างการสร้าง machine_configs เริ่มต้น
    await newStoreRef.collection('machine_configs').doc('washing_machine_1').set({
      type: 'washing',
      capacity: '10kg',
      price: 40,
      status: 'active'
    });
    await newStoreRef.collection('machine_configs').doc('drying_machine_1').set({
      type: 'drying',
      capacity: '15kg',
      price: 50,
      status: 'active'
    });

    // ตัวอย่างการสร้าง message_templates เริ่มต้น
    await newStoreRef.collection('message_templates').doc('welcome_message').set({
      templateId: 'welcome_message',
      title: 'ข้อความต้อนรับ',
      text: 'สวัสดีครับ/ค่ะ ยินดีต้อนรับสู่ {{storeName}}!\n\nเรามีบริการเครื่องซักผ้าและอบผ้าอัตโนมัติ.\n\nพิมพ์ "เมนู" เพื่อดูตัวเลือกต่างๆ ครับ/ค่ะ',
      keywords: ['welcome', 'สวัสดี']
    });
    await newStoreRef.collection('message_templates').doc('help_message').set({
      templateId: 'help_message',
      title: 'ข้อความช่วยเหลือ',
      text: 'ต้องการความช่วยเหลือใช่ไหมครับ/คะ?\n\n- พิมพ์ "เวลา" เพื่อเช็คสถานะเครื่องที่กำลังทำงาน\n- พิมพ์ "ราคา" เพื่อดูอัตราค่าบริการ\n- พิมพ์ "ติดต่อ" เพื่อสอบถามพนักงาน',
      keywords: ['help', 'ช่วยเหลือ']
    });

    // ส่ง Response กลับไปบอก Softr ว่าสำเร็จ
    // <--- แก้ไข: ปรับการส่ง Response โดยใช้ new Response
    return new Response(JSON.stringify({
      message: 'Store and Admin created successfully!',
      storeId: newStoreRef.id,
      adminUid: userRecord.uid,
      storeName: name
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('Error creating store:', error);
    // หากเกิด Error ระหว่างการสร้าง User หรือ Store ควรลบ User ที่สร้างไปแล้ว (ถ้ามี)
    if (userRecord && userRecord.uid) {
      await auth.deleteUser(userRecord.uid).catch(deleteError => {
        console.error('Failed to delete partially created user:', deleteError);
      });
    }
    // <--- แก้ไข: ปรับการส่ง Response โดยใช้ new Response
    return new Response(JSON.stringify({ message: 'Error creating store', error: error.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}