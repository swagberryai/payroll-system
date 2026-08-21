// firebaseService.js
// payroll_flow_prototype.jsx의 각 버튼 핸들러를 실제 Firestore 호출로 연결하는 서비스 레이어

import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, addDoc, updateDoc, setDoc, deleteDoc, doc, getDocs,
  query, where, serverTimestamp, Timestamp, onSnapshot,
} from "firebase/firestore";

// ── Firebase 실제 프로젝트 설정 ──
const firebaseConfig = {
  apiKey: "AIzaSyBZFcfsqV55BTfyKBQsC-_S7ciLFt5cqks",
  authDomain: "my-firebase-app-82e01.firebaseapp.com",
  projectId: "my-firebase-app-82e01",
  storageBucket: "my-firebase-app-82e01.firebasestorage.app",
  messagingSenderId: "1071863424515",
  appId: "1:1071863424515:web:b6b34db5dc274354ce9036",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

const employeesCol = collection(db, "employees");
const attendanceCol = collection(db, "attendance");
const storesCol = collection(db, "stores");
const payrollsCol = collection(db, "payrolls");
const salaryRulesCol = collection(db, "salaryRules");

// ── 실시간 바인딩 (onSnapshot) ──
export function subscribeEmployees(callback) {
  return onSnapshot(employeesCol, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(list);
  });
}

export function subscribeAttendance(callback) {
  return onSnapshot(attendanceCol, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(list);
  });
}

export function subscribeStores(callback) {
  return onSnapshot(storesCol, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(list);
  });
}

// ── 중복값 검증 (계좌번호/핸드폰/주민번호) ──
export async function checkDuplicate({ ssn, phone, account }, currentId = null) {
  const checks = [
    ssn && query(employeesCol, where("ssn", "==", ssn)),
    phone && query(employeesCol, where("phone", "==", phone)),
    account && query(employeesCol, where("account", "==", account)),
  ].filter(Boolean);

  for (const q of checks) {
    const snap = await getDocs(q);
    if (!snap.empty) {
      const match = snap.docs.find((d) => d.id !== currentId);
      if (match) {
        return { id: match.id, ...match.data() };
      }
    }
  }
  return null;
}

// ── 5-1. 사원등록 — 매장 입력 ──
export async function registerEmployee(form, storeCode, currentUserId = "store_user") {
  const dup = await checkDuplicate(form);
  if (dup) {
    throw new Error(`중복값 발견 — "${dup.name}"과(와) 정보가 겹칩니다. 등록할 수 없습니다.`);
  }
  const docRef = await addDoc(employeesCol, {
    ...form,
    storeCode,
    accountingConfirmed: false,
    hrConfirmed: false,
    resignConfirmed: false,
    status: "회계팀확인대기",
    createdAt: serverTimestamp(),
    createdBy: currentUserId,
  });
  return docRef.id;
}

// ── 기존 사원 정보 및 서류 수정/보완 ──
export async function updateEmployee(employeeId, form, currentUserId = "store_user") {
  const dup = await checkDuplicate(form, employeeId);
  if (dup) {
    throw new Error(`중복값 발견 — "${dup.name}"과(와) 정보가 겹칩니다. 수정할 수 없습니다.`);
  }
  const ref = doc(db, "employees", employeeId);
  try {
    await updateDoc(ref, {
      ...form,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId,
    });
  } catch (err) {
    await setDoc(ref, {
      ...form,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId,
    }, { merge: true });
  }
}

// ── 매장 신규 등록 ──
export async function registerStore(storeForm, currentUserId = "accounting_user") {
  const snap = await getDocs(storesCol);
  const nextSeq = snap.size + 1;
  const storeCode = storeForm.code || `STR-${String(nextSeq).padStart(3, "0")}`;

  const docRef = await addDoc(storesCol, {
    ...storeForm,
    code: storeCode,
    createdAt: serverTimestamp(),
    createdBy: currentUserId,
  });
  return docRef.id;
}

// ── 매장 정보 수정 (문서가 없을 경우 setDoc으로 유연 처리하여 에러 차단) ──
export async function updateStore(storeId, storeForm, currentUserId = "accounting_user") {
  const ref = doc(db, "stores", storeId);
  try {
    await updateDoc(ref, {
      ...storeForm,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId,
    });
  } catch (err) {
    await setDoc(ref, {
      ...storeForm,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId,
    }, { merge: true });
  }
}

// ── 매장 삭제 ──
export async function deleteStore(storeId) {
  const ref = doc(db, "stores", storeId);
  try {
    await deleteDoc(ref);
  } catch (err) {
    console.warn("Doc delete warning:", err);
  }
}

// ── 회계팀 퇴사자 확인 완료 ──
export async function confirmResignation(employeeId, confirmedByUserId = "accounting_user") {
  const ref = doc(db, "employees", employeeId);
  await updateDoc(ref, {
    resignConfirmed: true,
    resignConfirmedAt: serverTimestamp(),
    resignConfirmedBy: confirmedByUserId,
  });
}

// ── 회계팀 확인 대기 목록 조회 ──
export async function listPendingAccountingEmployees() {
  const q = query(employeesCol, where("accountingConfirmed", "==", false));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ── 회계팀 확인 (게이트 1단계) ──
export async function confirmAccounting(employeeId, confirmedByUserId = "accounting_user", extra = {}) {
  const ref = doc(db, "employees", employeeId);
  const payload = {
    ...extra,
    accountingConfirmed: true,
    accountingConfirmedAt: serverTimestamp(),
    accountingConfirmedBy: confirmedByUserId,
    status: "인사팀확인대기",
  };
  await updateDoc(ref, payload);
}

// ── 인사팀 확인 대기 목록 조회 ──
export async function listPendingHrEmployees() {
  const q = query(
    employeesCol,
    where("accountingConfirmed", "==", true),
    where("hrConfirmed", "==", false)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ── 인사팀 확인 (게이트 2단계) ──
export async function confirmHr(employeeId, confirmedByUserId = "hr_user", documents) {
  const ref = doc(db, "employees", employeeId);
  const payload = {
    hrConfirmed: true,
    hrConfirmedAt: serverTimestamp(),
    hrConfirmedBy: confirmedByUserId,
    status: "확정",
  };
  if (documents) {
    payload.documents = documents;
  }
  await updateDoc(ref, payload);
}

// ── 근태입력 (확정된 사원만 대상) ──
export async function listConfirmedEmployees(storeCode) {
  const q = storeCode
    ? query(
        employeesCol,
        where("storeCode", "==", storeCode),
        where("accountingConfirmed", "==", true),
        where("hrConfirmed", "==", true)
      )
    : query(
        employeesCol,
        where("accountingConfirmed", "==", true),
        where("hrConfirmed", "==", true)
      );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listAllEmployees() {
  const snap = await getDocs(employeesCol);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listAttendanceByStore(storeCode) {
  const q = storeCode
    ? query(attendanceCol, where("storeCode", "==", storeCode))
    : attendanceCol;
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function computeHours({ mode, start, end, hours }) {
  if (mode === "start-only") return 10;
  if (mode === "start-hours") return Number(f.hours) || 0;
  if (mode === "start-end" && start && end) {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const diff = (eh * 60 + em - (sh * 60 + sm)) / 60;
    return diff > 0 ? Math.round(diff * 10) / 10 : 0;
  }
  return 0;
}

export async function submitAttendance(attForm, storeCode, currentUserId = "store_user") {
  const totalHours = attForm.totalHours !== undefined ? Number(attForm.totalHours) : computeHours(attForm);
  const dateEnd = new Date(attForm.date + "T23:59:59");
  try {
    const q = query(
      attendanceCol,
      where("employeeId", "==", attForm.employeeId),
      where("date", "==", attForm.date)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const docId = snap.docs[0].id;
      const ref = doc(db, "attendance", docId);
      await updateDoc(ref, {
        ...attForm,
        storeCode,
        totalHours,
        editableUntil: Timestamp.fromDate(dateEnd),
        lastEditedAt: serverTimestamp(),
        lastEditedBy: currentUserId,
      });
    } else {
      await addDoc(attendanceCol, {
        ...attForm,
        storeCode,
        totalHours,
        editableUntil: Timestamp.fromDate(dateEnd),
        lastEditedAt: serverTimestamp(),
        lastEditedBy: currentUserId,
      });
    }
  } catch (err) {
    console.warn("Attendance submit fallback:", err);
  }
  return totalHours;
}

// ── 알바 주간 누적 근로시간 (실시간 경고용) ──
export async function getWeeklyHours(employeeId, weekStartDate, weekEndDate) {
  const q = query(
    attendanceCol,
    where("employeeId", "==", employeeId),
    where("type", "==", "정상출근"),
    where("date", ">=", weekStartDate),
    where("date", "<=", weekEndDate)
  );
  const snap = await getDocs(q);
  return snap.docs.reduce((sum, d) => sum + (d.data().totalHours || 0), 0);
}

// ── 본사 대시보드 — 미확인/미기재 현황 ──
export async function getDashboardAlerts() {
  const snap = await getDocs(employeesCol);
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return {
    missingAccount: all.filter((e) => !e.account),
    missingDocs: all.filter((e) => !e.documents || Object.values(e.documents).some((v) => !v)),
    waitingAccounting: all.filter((e) => !e.accountingConfirmed),
    waitingHr: all.filter((e) => e.accountingConfirmed && !e.hrConfirmed),
  };
}

// ── 급여 관리 (월별 데이터) ──
export function subscribePayrolls(storeCode, month, callback) {
  if (!storeCode || !month) {
    callback([]);
    return () => {};
  }
  const q = query(
    payrollsCol,
    where("storeCode", "==", storeCode),
    where("month", "==", month)
  );
  return onSnapshot(q, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(list);
  });
}

export async function updatePayrollCell(storeCode, month, employeeId, fieldName, value, isOverride = false) {
  const docId = `${storeCode}_${month}_${employeeId}`;
  const ref = doc(db, "payrolls", docId);
  
  // value가 빈 문자열이거나 undefined일 수 있으므로 그대로 저장
  const updateData = {
    storeCode,
    month,
    employeeId,
    [`data.${fieldName}`]: value,
    updatedAt: serverTimestamp(),
  };

  if (isOverride) {
    updateData[`data._overrides.${fieldName}`] = true;
  } else if (isOverride === false) {
    // 수동 오버라이드 해제 (자동계산으로 복귀할 경우) - 여기서는 단순히 값만 업데이트하고 override 필드는 놔두거나 삭제
    // Firestore에서 필드 삭제는 deleteField()를 쓰지만 단순화를 위해 false로 설정
    updateData[`data._overrides.${fieldName}`] = false;
  }

  try {
    await updateDoc(ref, updateData);
  } catch (err) {
    // 문서가 없으면 생성
    const initialData = {
      storeCode,
      month,
      employeeId,
      data: {
        [fieldName]: value,
        _overrides: isOverride ? { [fieldName]: true } : {}
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, initialData);
  }
}

// ── 급여 계산 규칙 ──
export function subscribeSalaryRules(storeCode, callback) {
  if (!storeCode) {
    callback(null);
    return () => {};
  }
  const ref = doc(db, "salaryRules", storeCode);
  return onSnapshot(ref, (docSnap) => {
    if (docSnap.exists()) {
      callback(docSnap.data().rules || []);
    } else {
      callback([]);
    }
  });
}

export async function saveSalaryRules(storeCode, rules) {
  const ref = doc(db, "salaryRules", storeCode);
  await setDoc(ref, { rules, updatedAt: serverTimestamp() }, { merge: true });
}
