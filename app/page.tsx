'use client'; // ยังคงต้องเป็น Client Component เพื่อใช้ useState/useEffect ได้

import { useState, useEffect } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import Image from 'next/image'; // Import Image component for optimized images

// === กำหนดค่า Firebase (ใช้ของโปรเจกต์คุณ) ===
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID, 
};

// Initialize Firebase if not already initialized
let firebaseApp;
if (!getApps().length) {
  firebaseApp = initializeApp(firebaseConfig);
} else {
  firebaseApp = getApp(); // if already initialized, use that one
}

const db = getFirestore(firebaseApp);

// กำหนด ID ร้านค้า (ต้องตรงกับ Document ID ของร้านใน Firestore)
const STORE_ID = 'laundry_1'; 

export default function HomePage() {
  const [pageContent, setPageContent] = useState({
    title: '🧺 Washing & Drying 🧺',
    subtitle: 'ร้านซัก-อบ จบครบที่เดียว หน้าโลตัสอินทร์',
    notification_header: 'แจ้งเตือนเมื่อผ้าซัก-อบเสร็จ!',
    notification_description: 'ไม่ต้องรอ ไม่ต้องเฝ้า! ระบบจะแจ้งเตือนคุณผ่าน LINE ทันทีที่ผ้าของคุณซักหรืออบเสร็จ',
    step1_text: 'สแกน QR Code ที่หน้าเครื่องซัก-อบ',
    step2_text: 'กดปุ่มด้านล่างเพื่อเพิ่มเพื่อน LINE Official Account ของร้านเรา',
    step3_text: 'พิมพ์ "สวัสดี" หรือข้อความใดๆ ใน LINE Chat แล้วทำตามขั้นตอนเพื่อเลือกเครื่องและเริ่มจับเวลา',
    button_text: 'เพิ่มเพื่อนใน LINE รับการแจ้งเตือน',
    footer_note: '(ระบบจะส่งข้อความแจ้งเตือนผ่าน LINE Official Account ของเรา)',
  });
  const [loadingContent, setLoadingContent] = useState(true);

  const lineAddFriendUrl = "https://line.me/R/ti/p/@618hbfvj"; // LINE OA ID ของคุณ

  useEffect(() => {
    const fetchContent = async () => {
      try {
        const templatesCol = collection(db, 'stores', STORE_ID, 'message_templates');
        const snapshot = await getDocs(templatesCol);

        const fetchedContent: { [key: string]: string } = {};
        snapshot.forEach(doc => {
          const data = doc.data();
          if (data.id && data.text) {
            fetchedContent[data.id] = data.text;
          }
        });

        setPageContent(prev => ({
          ...prev,
          title: fetchedContent['landing_page_title'] || prev.title,
          subtitle: fetchedContent['landing_page_subtitle'] || prev.subtitle,
          notification_header: fetchedContent['landing_page_notification_header'] || prev.notification_header,
          notification_description: fetchedContent['landing_page_notification_description'] || prev.notification_description,
          step1_text: fetchedContent['landing_page_step1_text'] || prev.step1_text,
          step2_text: fetchedContent['landing_page_step2_text'] || prev.step2_text,
          step3_text: fetchedContent['landing_page_step3_text'] || prev.step3_text,
          button_text: fetchedContent['landing_page_button_text'] || prev.button_text,
          footer_note: fetchedContent['landing_page_footer_note'] || prev.footer_note,
        }));
      } catch (err) {
        console.error("Error fetching landing page content:", err);
        // Fallback to default texts if fetch fails
      } finally {
        setLoadingContent(false);
      }
    };

    fetchContent();
  }, []);


  return (
    <div className="container" style={{ maxWidth: '100%', padding: '10px', margin: '10px auto' }}>
      <div className="card">
        {loadingContent ? (
            <p style={{ fontSize: '1em', color: 'var(--text-dark)' }}>กำลังโหลดข้อมูล...</p>
        ) : (
            <>
                <h1 style={{ color: 'var(--primary-pink)', fontSize: '1.8em', marginBottom: '10px' }}>
                    <span style={{ fontSize: '1.5em', verticalAlign: 'middle', marginRight: '5px' }}>🧺</span>
                    {pageContent.title.replace('🧺', '').trim()} {/* Display dynamic title */}
                    <span style={{ fontSize: '1.5em', verticalAlign: 'middle', marginLeft: '5px' }}>🧺</span>
                </h1>
                <p style={{ color: 'var(--text-dark)', fontSize: '1.0em', marginBottom: '15px' }}>
                    {pageContent.subtitle} {/* Display dynamic subtitle */}
                </p>

                <h2 style={{ color: 'var(--dark-pink)', fontSize: '1.4em', marginTop: '20px', marginBottom: '10px' }}>
                    <span style={{ fontSize: '1.2em', verticalAlign: 'middle', marginRight: '5px' }}>🔔</span>
                    {pageContent.notification_header} {/* Display dynamic notification header */}
                </h2>
                <p style={{ fontSize: '0.9em', color: 'var(--text-dark)', marginBottom: '20px', lineHeight: '1.5' }}>
                    {pageContent.notification_description} {/* Display dynamic notification description */}
                </p>

                {/* Instruction Steps */}
                <div style={{ textAlign: 'left', padding: '10px', borderRadius: '8px', backgroundColor: 'var(--bg-light)', marginBottom: '20px' }}>
                    <h3 style={{ color: 'var(--primary-pink)', fontSize: '1.1em', marginTop: '0', marginBottom: '8px' }}>ขั้นตอนง่ายๆ:</h3>
                    <ol style={{ paddingLeft: '20px', margin: '0', fontSize: '0.85em', color: 'var(--text-dark)' }}>
                        <li style={{ marginBottom: '6px' }}>
                            <span style={{ fontWeight: 'bold' }}>1. สแกน QR Code:</span> {pageContent.step1_text}
                        </li>
                        <li style={{ marginBottom: '6px' }}>
                            <span style={{ fontWeight: 'bold' }}>2. กดเพิ่มเพื่อนใน LINE:</span> {pageContent.step2_text}
                        </li>
                        <li>
                            <span style={{ fontWeight: 'bold' }}>3. เลือกเครื่องใน LINE Chat:</span> {pageContent.step3_text}
                        </li>
                    </ol>
                </div>

                {/* LINE Add Friend Button */}
                <a
                    href={lineAddFriendUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="line-button"
                    style={{ padding: '10px 20px', fontSize: '1em' }}
                >
                    <Image
                        src="https://cdn.icon-icons.com/icons2/2429/PNG/512/line_logo_icon_147253.png"
                        alt="LINE icon"
                        width={30}
                        height={30}
                        style={{ verticalAlign: 'middle', marginRight: '5px' }}
                    />
                    {pageContent.button_text} {/* Display dynamic button text */}
                </a>

                <p style={{ fontSize: '0.8em', color: '#777', marginTop: '15px' }}>
                    {pageContent.footer_note} {/* Display dynamic footer note */}
                </p>
            </>
        )}
      </div>
    </div>
  );
}