'use client';

import { useState, useEffect, Suspense } from 'react'; // เพิ่ม Suspense
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, Timestamp, where, query } from 'firebase/firestore';
import { useSearchParams } from 'next/navigation';

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

// === รหัสผ่านสำหรับเข้าหน้า Admin ===
const ADMIN_PASSWORD = 'admin123'; 

interface MachineConfig {
  id: string; // Document ID from Firestore
  machine_id: number;
  machine_type: 'washer' | 'dryer';
  duration_minutes: number;
  is_active: boolean;
  display_name: string;
}

interface ActiveTimer {
  id: string; // Document ID from Firestore (timers collection)
  user_id: string;
  machine_id: number;
  machine_type: 'washer' | 'dryer';
  display_name: string;
  duration_minutes: number;
  end_time: Timestamp;
  status: string;
}

interface MessageTemplate {
  docId: string;  // Firestore document ID
  id: string;     // Custom ID like 'initial_greeting'
  text: string;
}

// === Component ย่อยที่ดึงข้อมูลจาก URL และแสดงหน้า Admin หลัก ===
// เราใช้ Component นี้เพื่อครอบคลุมการใช้ useSearchParams
function AdminPageContent() {
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [error, setError] = useState('');
  const [machines, setMachines] = useState<MachineConfig[]>([]);
  const [activeTimers, setActiveTimers] = useState<ActiveTimer[]>([]);
  const [loadingMachines, setLoadingMachines] = useState(true);
  const [loadingTimers, setLoadingTimers] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState({ duration_minutes: 0, is_active: false });

  const [messages, setMessages] = useState<MessageTemplate[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editMessageText, setEditMessageText] = useState('');

  // === ดึง STORE_ID จาก URL parameter ===
  const searchParams = useSearchParams();
  const STORE_ID = searchParams.get('storeId') || 'laundry_5'; // ใช้ laundry_5 เป็นค่าเริ่มต้น

  useEffect(() => {
    if (loggedIn) {
      fetchMachineConfigs();
      fetchActiveTimers();
      fetchMessages();
    }
  }, [loggedIn]);

  const fetchMachineConfigs = async () => {
    setLoadingMachines(true);
    try {
      const machineConfigsCol = collection(db, 'stores', STORE_ID, 'machine_configs');
      const machineSnapshot = await getDocs(machineConfigsCol);
      const machineList = machineSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as MachineConfig[];
      machineList.sort((a, b) => {
          if (a.machine_type === b.machine_type) {
              return a.machine_id - b.machine_id;
          }
          return a.machine_type.localeCompare(b.machine_type);
      });
      setMachines(machineList);
    } catch (err) {
      console.error("Error fetching machine configs:", err);
      setError("ไม่สามารถดึงข้อมูลการตั้งค่าเครื่องได้");
    } finally {
      setLoadingMachines(false);
    }
  };

  const fetchActiveTimers = async () => {
    setLoadingTimers(true);
    try {
      const timersCol = collection(db, 'stores', STORE_ID, 'timers');
      const q = query(timersCol, where('status', '==', 'pending'));
      const activeTimersSnapshot = await getDocs(q);
      const timerList = activeTimersSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ActiveTimer[];
      timerList.sort((a, b) => a.end_time.toDate().getTime() - b.end_time.toDate().getTime());
      setActiveTimers(timerList);
    } catch (err) {
      console.error("Error fetching active timers:", err);
      setError("ไม่สามารถดึงข้อมูลรายการที่กำลังทำงานได้");
    } finally {
      setLoadingTimers(false);
    }
  };

  const fetchMessages = async () => {
    setLoadingMessages(true);
    try {
      const templatesCol = collection(db, 'stores', STORE_ID, 'message_templates');
      const snapshot = await getDocs(templatesCol);
      const templates = snapshot.docs.map(d => ({
        docId: d.id,
        id: d.data().id,
        text: d.data().text,
      })) as MessageTemplate[];
      templates.sort((a, b) => a.id.localeCompare(b.id));
      setMessages(templates);
    } catch (err) {
      console.error("Error fetching messages:", err);
      setError("ไม่สามารถดึงข้อมูลข้อความตอบกลับได้");
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      setLoggedIn(true);
      setError('');
    } else {
      setError('รหัสผ่านไม่ถูกต้อง');
      setLoggedIn(false);
    }
  };

  const handleEditClick = (machine: MachineConfig) => {
    setEditingId(machine.id);
    setEditFormData({
      duration_minutes: machine.duration_minutes,
      is_active: machine.is_active,
    });
  };

  const handleSaveClick = async (machineId: string) => {
    try {
      const machineRef = doc(db, 'stores', STORE_ID, 'machine_configs', machineId);
      await updateDoc(machineRef, {
        duration_minutes: editFormData.duration_minutes,
        is_active: editFormData.is_active,
      });
      await fetchMachineConfigs();
      setEditingId(null);
    } catch (err) {
      console.error("Error updating machine config:", err);
      setError("ไม่สามารถบันทึกการเปลี่ยนแปลงได้");
    }
  };

  const handleCancelClick = () => {
    setEditingId(null);
  };
  
  const handleEditMessageClick = (message: MessageTemplate) => {
    setEditingMessageId(message.docId);
    setEditMessageText(message.text);
  };

  const handleSaveMessageClick = async (docId: string) => {
    try {
      const messageRef = doc(db, 'stores', STORE_ID, 'message_templates', docId);
      await updateDoc(messageRef, { text: editMessageText });
      await fetchMessages();
      setEditingMessageId(null);
    } catch (err) {
      console.error("Error updating message:", err);
      setError("ไม่สามารถบันทึกข้อความได้");
    }
  };

  const handleCancelMessageClick = () => {
    setEditingMessageId(null);
  };

  const handleCancelTimer = async (timerId: string, machineDisplayName: string) => {
    if (window.confirm(`คุณแน่ใจหรือไม่ที่จะยกเลิกการจับเวลาของ ${machineDisplayName} (ID: ${timerId})?`)) {
      try {
        const response = await fetch('/api/admin/timers/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timerId, storeId: STORE_ID }),
        });
        if (response.ok) {
            alert(`ยกเลิกการจับเวลาของ ${machineDisplayName} เรียบร้อยแล้ว`);
            await fetchActiveTimers();
        } else {
            const errorData = await response.json();
            alert(`ไม่สามารถยกเลิกได้: ${errorData.message || 'เกิดข้อผิดพลาด'}`);
        }
      } catch (err) {
        console.error("Error cancelling timer:", err);
        alert("เกิดข้อผิดพลาดในการยกเลิกการจับเวลา");
      }
    }
  };

  if (loggedIn) {
    return (
      <div className="container" style={{ maxWidth: '900px', padding: '30px', margin: '20px auto' }}>
        <div className="card">
          <h1 style={{ color: 'var(--primary-pink)' }}>
            <span style={{ fontSize: '1.5em', verticalAlign: 'middle', marginRight: '10px' }}>⚙️</span>
            แผงควบคุมผู้ดูแล
          </h1>
          <p style={{ color: 'var(--text-dark)', marginBottom: '20px' }}>จัดการการตั้งค่าและข้อความตอบกลับของร้าน</p>

          <p style={{ color: 'var(--text-dark)', marginBottom: '20px', fontWeight: 'bold' }}>
            ร้านค้า ID: {STORE_ID}
          </p>

          <button
            className="line-button"
            style={{ backgroundColor: 'var(--dark-pink)', marginBottom: '30px' }}
            onClick={() => setLoggedIn(false)}
          >
            <span style={{ fontSize: '1.2em', verticalAlign: 'middle', marginRight: '5px' }}>🚪</span>
            ออกจากระบบ
          </button>

          {error && <p style={{ color: '#dc3545', marginBottom: '15px', fontWeight: 'bold' }}>{error}</p>}
          
          <h2 style={{ color: 'var(--dark-pink)', marginTop: '40px', marginBottom: '20px' }}>
            <span style={{ fontSize: '1.2em', verticalAlign: 'middle', marginRight: '5px' }}>🔧</span>
            การตั้งค่าเครื่องซักผ้า/อบผ้า 
          </h2>
          {loadingMachines ? (
            <p>กำลังโหลดข้อมูลเครื่องจักร...</p>
          ) : (
            <div className="machine-list" style={{ textAlign: 'left' }}>
              {machines.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#777' }}>ไม่พบข้อมูลเครื่องจักร</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--light-pink)' }}>
                      <th style={{ padding: '10px', textAlign: 'left', color: 'var(--dark-pink)' }}>เครื่อง</th>
                      <th style={{ padding: '10px', textAlign: 'left', color: 'var(--dark-pink)' }}>ประเภท</th>
                      <th style={{ padding: '10px', textAlign: 'left', color: 'var(--dark-pink)' }}>เวลา (นาที)</th>
                      <th style={{ padding: '10px', textAlign: 'left', color: 'var(--dark-pink)' }}>สถานะ</th>
                      <th style={{ padding: '10px', textAlign: 'right', color: 'var(--dark-pink)' }}>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {machines.map(machine => (
                      <tr key={machine.id} style={{ borderBottom: '1px dashed #eee' }}>
                        <td style={{ padding: '10px', fontWeight: 'bold' }}>{machine.display_name}</td>
                        <td style={{ padding: '10px' }}>{machine.machine_type === 'washer' ? 'ซักผ้า' : 'อบผ้า'}</td>
                        <td style={{ padding: '10px' }}>
                          {editingId === machine.id ? (
                            <input
                              type="number"
                              value={editFormData.duration_minutes}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditFormData({ ...editFormData, duration_minutes: parseInt(e.target.value) || 0 })}
                              style={{ width: '60px', padding: '5px', borderRadius: '5px', border: '1px solid #ccc' }}
                            />
                          ) : (
                            machine.duration_minutes
                          )}
                        </td>
                        <td style={{ padding: '10px' }}>
                          {editingId === machine.id ? (
                            <input
                              type="checkbox"
                              checked={editFormData.is_active}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditFormData({ ...editFormData, is_active: e.target.checked })}
                            />
                          ) : (
                            machine.is_active ?
                              <span style={{ color: 'var(--line-green)', fontWeight: 'bold' }}>ใช้งานอยู่</span> :
                              <span style={{ color: '#dc3545', fontWeight: 'bold' }}>ปิดใช้งาน</span>
                          )}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          {editingId === machine.id ? (
                            <>
                              <button
                                className="line-button"
                                style={{ backgroundColor: 'var(--line-green)', padding: '8px 12px', fontSize: '0.9em', marginRight: '5px' }}
                                onClick={() => handleSaveClick(machine.id)}
                              >
                                บันทึก
                              </button>
                              <button
                                className="line-button"
                                style={{ backgroundColor: '#6c757d', padding: '8px 12px', fontSize: '0.9em' }}
                                onClick={handleCancelClick}
                              >
                                ยกเลิก
                              </button>
                            </>
                          ) : (
                            <button
                              className="line-button"
                              style={{ backgroundColor: 'var(--primary-pink)', padding: '8px 12px', fontSize: '0.9em' }}
                              onClick={() => handleEditClick(machine)}
                            >
                              แก้ไข
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <h2 style={{ color: 'var(--dark-pink)', marginTop: '40px', marginBottom: '20px' }}>
            <span style={{ fontSize: '1.2em', verticalAlign: 'middle', marginRight: '5px' }}>⏱️</span>
            รายการเครื่องที่กำลังทำงาน
          </h2>
          {loadingTimers ? (
            <p>กำลังโหลดรายการที่กำลังทำงาน...</p>
          ) : (
            <div className="active-timers-list" style={{ textAlign: 'left' }}>
              {activeTimers.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#777' }}>ไม่มีเครื่องใดกำลังทำงานอยู่</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--light-pink)' }}>
                      <th style={{ padding: '10px', textAlign: 'left', color: 'var(--dark-pink)' }}>เครื่อง</th>
                      <th style={{ padding: '10px', textAlign: 'left', color: 'var(--dark-pink)' }}>เริ่มโดย</th>
                      <th style={{ padding: '10px', textAlign: 'left', color: 'var(--dark-pink)' }}>เสร็จใน</th>
                      <th style={{ padding: '10px', textAlign: 'right', color: 'var(--dark-pink)' }}>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeTimers.map(timer => (
                      <tr key={timer.id} style={{ borderBottom: '1px dashed #eee' }}>
                        <td style={{ padding: '10px', fontWeight: 'bold' }}>{timer.display_name} ({timer.duration_minutes} นาที)</td>
                        <td style={{ padding: '10px', fontSize: '0.9em' }}>{timer.user_id.substring(0, 8)}...</td>
                        <td style={{ padding: '10px' }}>{new Date(timer.end_time.seconds * 1000).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          <button
                            className="line-button"
                            style={{ backgroundColor: '#dc3545', padding: '8px 12px', fontSize: '0.9em' }}
                            onClick={() => handleCancelTimer(timer.id, timer.display_name)}
                          >
                            ยกเลิกการจับเวลา
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <h2 style={{ color: 'var(--dark-pink)', marginTop: '40px', marginBottom: '20px' }}>
            <span style={{ fontSize: '1.2em', verticalAlign: 'middle', marginRight: '5px' }}>📝</span>
            จัดการข้อความตอบกลับ
          </h2>
          {loadingMessages ? (
            <p>กำลังโหลดข้อมูลข้อความ...</p>
          ) : (
            <div className="message-list" style={{ textAlign: 'left' }}>
              {messages.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#777' }}>ไม่พบข้อมูลข้อความ</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--light-pink)' }}>
                      <th style={{ padding: '10px', textAlign: 'left', color: 'var(--dark-pink)' }}>ID ข้อความ</th>
                      <th style={{ padding: '10px', textAlign: 'left', color: 'var(--dark-pink)' }}>เนื้อหา</th>
                      <th style={{ padding: '10px', textAlign: 'right', color: 'var(--dark-pink)' }}>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messages.map(msg => (
                      <tr key={msg.docId} style={{ borderBottom: '1px dashed #eee' }}>
                        <td style={{ padding: '10px', fontFamily: 'monospace', color: '#c7254e' }}>{msg.id}</td>
                        <td style={{ padding: '10px', width: '60%' }}>
                          {editingMessageId === msg.docId ? (
                            <textarea
                              value={editMessageText}
                              onChange={(e) => setEditMessageText(e.target.value)}
                              style={{ width: '100%', minHeight: '80px', padding: '8px', boxSizing: 'border-box', border: '1px solid #ddd', borderRadius: '4px' }}
                              rows={3}
                            />
                          ) : (
                            <span style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</span>
                          )}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          {editingMessageId === msg.docId ? (
                            <>
                              <button
                                className="line-button"
                                style={{ backgroundColor: 'var(--line-green)', padding: '8px 12px', fontSize: '0.9em', marginRight: '5px' }}
                                onClick={() => handleSaveMessageClick(msg.docId)}
                              >
                                บันทึก
                              </button>
                              <button
                                className="line-button"
                                style={{ backgroundColor: '#6c757d', padding: '8px 12px', fontSize: '0.9em' }}
                                onClick={handleCancelMessageClick}
                              >
                                ยกเลิก
                              </button>
                            </>
                          ) : (
                            <button
                              className="line-button"
                              style={{ backgroundColor: 'var(--primary-pink)', padding: '8px 12px', fontSize: '0.9em' }}
                              onClick={() => handleEditMessageClick(msg)}
                            >
                              แก้ไข
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ textAlign: 'center', padding: '50px' }}>
      <div className="card">
        <h1>เข้าสู่ระบบผู้ดูแล</h1>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <input
            type="password"
            placeholder="กรุณาใส่รหัสผ่าน"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            style={{
              padding: '12px',
              margin: '15px 0',
              borderRadius: '8px',
              border: '1px solid #ddd',
              width: '80%',
              maxWidth: '300px',
              fontSize: '1em'
            }}
          />
          {error && <p style={{ color: '#dc3545', fontSize: '0.9em', marginBottom: '10px' }}>{error}</p>}
          <button
            type="submit"
            className="line-button"
            style={{ backgroundColor: '#007bff' }}
          >
            เข้าสู่ระบบ
          </button>
        </form>
      </div>
    </div>
  );
}