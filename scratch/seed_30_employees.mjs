import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, deleteDoc, setDoc, doc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBZFcfsqV55BTfyKBQsC-_S7ciLFt5cqks",
  authDomain: "my-firebase-app-82e01.firebaseapp.com",
  projectId: "my-firebase-app-82e01",
  storageBucket: "my-firebase-app-82e01.firebasestorage.app",
  messagingSenderId: "1071863424515",
  appId: "1:1071863424515:web:b6b34db5dc274354ce9036",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const lastNames = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "류", "홍"];
const firstNames = ["민준", "서연", "도윤", "지우", "서준", "하은", "주원", "지민", "예준", "수아", "현우", "다은", "지호", "유진", "우진", "채원", "건우", "윤서", "성민", "지안", "태오", "병욱", "성진", "혜진", "상철", "영희", "철수", "미경", "동현", "보람"];
const depts = ["홀팀", "주방팀", "조리팀", "매장관리", "물류/자재", "서비스팀"];
const positions = ["팀장", "매니저", "캡틴", "주임", "사원"];

function getRandomName(idx) {
  const l = lastNames[idx % lastNames.length];
  const f = firstNames[idx % firstNames.length];
  return `${l}${f}`;
}

async function seed30PerStore() {
  console.log("Seeding 30 employees per store into Firestore...");

  // Clear existing employees
  const empSnap = await getDocs(collection(db, "employees"));
  for (const d of empSnap.docs) {
    await deleteDoc(doc(db, "employees", d.id));
  }

  const stores = [
    { name: "고메스퀘어 부천점", code: "STR-002" },
    { name: "고메스퀘어 신대방점", code: "STR-003" },
  ];

  let empCounter = 1;

  for (const st of stores) {
    console.log(`Generating 30 employees for ${st.name}...`);
    for (let i = 1; i <= 30; i++) {
      const empId = `EMP_${st.code}_${String(i).padStart(3, "0")}`;
      const name = getRandomName(empCounter++);
      
      // Distribution: 1~10: 정직원, 11~20: 아르바이트, 21~30: 일용직
      let type = "정직원";
      if (i > 10 && i <= 20) type = "아르바이트";
      if (i > 20) type = "일용직";

      const dept = depts[i % depts.length];
      const position = type === "정직원" ? positions[i % positions.length] : "";

      const employeeDoc = {
        id: empId,
        name: name,
        ssn: `9${(i % 9) + 0}01${String((i % 28) + 1).padStart(2, "0")}-1${String(100000 + i).slice(1)}`,
        phone: `010-${String(1000 + i * 3).slice(0, 4)}-${String(5000 + i * 7).slice(0, 4)}`,
        hireDate: `2025-0${(i % 8) + 1}-10`,
        resignDate: "",
        account: i % 3 === 0 ? "" : `국민 404002-04-${String(100000 + i)}`,
        position: position,
        dept: dept,
        employmentType: type,
        storeCode: st.name,
        idCard: i % 4 !== 0,
        bankbook: i % 5 !== 0,
        healthCert: i % 3 !== 0,
        contract: i % 3 !== 0,
        accountingConfirmed: true, // confirmed for attendance testing
        hrConfirmed: true,
        accountingConfirmedAt: new Date().toISOString(),
        hrConfirmedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await setDoc(doc(db, "employees", empId), employeeDoc);
    }
  }

  console.log("30 employees per store seeded successfully!");
  process.exit(0);
}

seed30PerStore().catch(console.error);
