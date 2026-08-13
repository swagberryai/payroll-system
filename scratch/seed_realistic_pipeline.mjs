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

// 60명의 완전히 중복 없는 성명 생성
const fullNames = [
  "김도윤", "이서연", "박민준", "최하은", "정지우", "강서준", "조수아", "윤현우", "장다은", "임지호",
  "한유진", "오우진", "서채원", "신건우", "권윤서", "황성민", "안지안", "송태오", "류병욱", "홍성진",
  "문혜진", "양상철", "손영희", "배철수", "조미경", "백동현", "허보람", "유재석", "남궁민", "심은경",
  "노승범", "하정우", "곽도원", "성시경", "차은우", "주지훈", "유연석", "고경표", "서강준", "이도현",
  "박은빈", "김태리", "한소희", "신혜선", "임윤아", "수지", "아이유", "안효섭", "송강", "변우석",
  "김수현", "박보검", "지창욱", "이종석", "전지현", "송혜교", "손예진", "김혜수", "마동석", "황정민"
];

const banks = ["국민", "신한", "하나", "우리", "농협", "기업", "카카오뱅크", "토스뱅크"];
const depts = ["홀팀", "주방팀", "조리팀", "매장관리", "물류/자재", "서비스팀"];
const positions = ["매니저", "팀장", "캡틴", "주임", "사원"];

async function seedPipeline() {
  console.log("Seeding 60 unique employees with realistic approval workflow stages...");

  // 1. 기존 사원 컬렉션 초기화
  const empSnap = await getDocs(collection(db, "employees"));
  for (const d of empSnap.docs) {
    await deleteDoc(doc(db, "employees", d.id));
  }

  const stores = [
    { name: "고메스퀘어 부천점", code: "STR-002" },
    { name: "고메스퀘어 신대방점", code: "STR-003" },
  ];

  let totalIdx = 0;

  for (const st of stores) {
    console.log(`Generating 30 unique employees for ${st.name}...`);

    for (let i = 1; i <= 30; i++) {
      const empId = `EMP_${st.code}_${String(i).padStart(3, "0")}`;
      const name = fullNames[totalIdx];

      // 고용형태: 1~10 정직원, 11~20 아르바이트, 21~30 일용직
      let type = "정직원";
      if (i > 10 && i <= 20) type = "아르바이트";
      if (i > 20) type = "일용직";

      const dept = depts[i % depts.length];
      const position = type === "정직원" ? positions[i % positions.length] : "";

      // 100% 고유한 주민번호, 전화번호, 입사일, 계좌번호 생성
      const birthYear = 80 + (totalIdx % 22); // 80~01년생
      const birthMonth = String((totalIdx % 12) + 1).padStart(2, "0");
      const birthDay = String((totalIdx % 27) + 1).padStart(2, "0");
      const gender = (totalIdx % 2 === 0) ? "1" : "2";
      const ssn = `${String(birthYear).slice(-2)}${birthMonth}${birthDay}-${gender}${String(123450 + totalIdx * 17).slice(-6)}`;

      const phoneMid = String(2000 + totalIdx * 37).slice(-4);
      const phoneEnd = String(5000 + totalIdx * 43).slice(-4);
      const phone = `010-${phoneMid}-${phoneEnd}`;

      const hireMonth = String((totalIdx % 12) + 1).padStart(2, "0");
      const hireDay = String((totalIdx % 25) + 1).padStart(2, "0");
      const hireDate = `2025-${hireMonth}-${hireDay}`;

      const bank = banks[totalIdx % banks.length];
      const accNum = `${String(100 + totalIdx * 3)}-${String(10 + totalIdx * 7)}-${String(10000 + totalIdx * 131).slice(-6)}`;
      const account = `${bank} ${accNum}`;

      // 파이프라인 승인 단계 분배 (각 매장 30명 중):
      // 1~8번 (8명): 회계팀 확인 대기 중 (accountingConfirmed: false, hrConfirmed: false) ➔ 회계팀 사원등록 확인탭에 표출!
      // 9~16번 (8명): 인사팀 최종 승인 대기 중 (accountingConfirmed: true, hrConfirmed: false) ➔ 인사팀 최종승인탭에 표출!
      // 17~30번 (14명): 최종 승인 완료 (accountingConfirmed: true, hrConfirmed: true) ➔ 매장 근태입력에 즉시 표출!
      let accountingConfirmed = false;
      let hrConfirmed = false;
      let accountingConfirmedAt = null;
      let hrConfirmedAt = null;

      if (i > 8) {
        accountingConfirmed = true;
        accountingConfirmedAt = new Date(Date.now() - (30 - i) * 3600000).toISOString();
      }
      if (i > 16) {
        hrConfirmed = true;
        hrConfirmedAt = new Date(Date.now() - (30 - i) * 1800000).toISOString();
      }

      // 서류 첨부 상태
      const idCard = i % 5 !== 0 ? true : false;
      const bankbook = i % 4 !== 0 ? true : false;
      const healthCert = i % 3 !== 0 ? true : false;
      const contract = i % 3 !== 0 ? true : false;

      const employeeDoc = {
        id: empId,
        name: name,
        ssn: ssn,
        phone: phone,
        hireDate: hireDate,
        resignDate: "",
        account: account,
        position: position,
        dept: dept,
        employmentType: type,
        storeCode: st.name,
        idCard: idCard,
        bankbook: bankbook,
        healthCert: healthCert,
        contract: contract,
        accountingConfirmed: accountingConfirmed,
        hrConfirmed: hrConfirmed,
        accountingConfirmedAt: accountingConfirmedAt,
        hrConfirmedAt: hrConfirmedAt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await setDoc(doc(db, "employees", empId), employeeDoc);
      totalIdx++;
    }
  }

  console.log("Realistic pipeline data seeded successfully!");
  process.exit(0);
}

seedPipeline().catch(console.error);
