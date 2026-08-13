// mockService.js
// ../firebaseService.js 와 동일한 함수 시그니처를 갖는 로컬 목업 서비스 레이어.
// Firebase 프로젝트가 준비되면 payroll_flow_prototype.jsx 상단의
// import 경로만 "./mockService" → "../firebaseService"로 바꾸면 그대로 연결됩니다.
//
// 주의: confirmAccounting(employeeId, confirmedByUserId, extra)의 3번째 인자(계좌/직급/부서 등)는
// 이 목업에서만 지원합니다. firebaseService.js로 교체 시 동일하게 병합 업데이트하도록
// 그쪽 함수도 extra 인자를 받아 반영해야 합니다 (firestore.rules는 이미 해당 필드들의
// 동시 수정을 허용하도록 되어 있습니다).

let employees = [];
let attendance = [];
let idCounter = 1;

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export async function checkDuplicate({ ssn, phone, account }) {
  const dup = employees.find(
    (e) =>
      (ssn && e.ssn === ssn) ||
      (phone && e.phone === phone) ||
      (account && e.account === account)
  );
  return dup ? clone(dup) : null;
}

export async function registerEmployee(form, storeCode, currentUserId) {
  const dup = await checkDuplicate(form);
  if (dup) {
    throw new Error(`중복값 발견 — "${dup.name}"과(와) 정보가 겹칩니다. 등록할 수 없습니다.`);
  }
  const id = String(idCounter++);
  employees.push({
    id,
    ...form,
    storeCode,
    accountingConfirmed: false,
    hrConfirmed: false,
    status: "회계팀확인대기",
    createdAt: new Date(),
    createdBy: currentUserId,
  });
  return id;
}

export async function confirmAccounting(employeeId, confirmedByUserId, extra = {}) {
  const e = employees.find((e) => e.id === employeeId);
  if (!e) throw new Error("사원을 찾을 수 없습니다.");
  Object.assign(e, extra, {
    accountingConfirmed: true,
    accountingConfirmedAt: new Date(),
    accountingConfirmedBy: confirmedByUserId,
    status: "인사팀확인대기",
  });
}

export async function listPendingHrEmployees() {
  return clone(employees.filter((e) => e.accountingConfirmed && !e.hrConfirmed));
}

export async function confirmHr(employeeId, confirmedByUserId, documents) {
  const e = employees.find((e) => e.id === employeeId);
  if (!e) throw new Error("사원을 찾을 수 없습니다.");
  Object.assign(e, {
    hrConfirmed: true,
    hrConfirmedAt: new Date(),
    hrConfirmedBy: confirmedByUserId,
    status: "확정",
    documents: documents || e.documents,
  });
}

export async function listConfirmedEmployees(storeCode) {
  return clone(
    employees.filter(
      (e) => e.storeCode === storeCode && e.accountingConfirmed && e.hrConfirmed
    )
  );
}

function computeHours({ mode, start, end, hours }) {
  if (mode === "start-only") return 10;
  if (mode === "start-hours") return Number(hours) || 0;
  if (mode === "start-end" && start && end) {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const diff = (eh * 60 + em - (sh * 60 + sm)) / 60;
    return diff > 0 ? Math.round(diff * 10) / 10 : 0;
  }
  return 0;
}

export async function submitAttendance(attForm, storeCode, currentUserId) {
  const totalHours = computeHours(attForm);
  const dateEnd = new Date(attForm.date + "T23:59:59");
  attendance.push({
    id: String(idCounter++),
    ...attForm,
    storeCode,
    totalHours,
    editableUntil: dateEnd,
    lastEditedAt: new Date(),
    lastEditedBy: currentUserId,
  });
  return totalHours;
}

export async function getWeeklyHours(employeeId, weekStartDate, weekEndDate) {
  return attendance
    .filter(
      (a) =>
        a.employeeId === employeeId &&
        a.type === "정상출근" &&
        a.date >= weekStartDate &&
        a.date <= weekEndDate
    )
    .reduce((sum, a) => sum + (a.totalHours || 0), 0);
}

export async function getDashboardAlerts() {
  const all = clone(employees);
  return {
    missingAccount: all.filter((e) => !e.account),
    missingDocs: all.filter(
      (e) => !e.documents || Object.values(e.documents).some((v) => !v)
    ),
    waitingAccounting: all.filter((e) => !e.accountingConfirmed),
    waitingHr: all.filter((e) => e.accountingConfirmed && !e.hrConfirmed),
  };
}

// ── 프로토타입 화면 전용 헬퍼 (firebaseService.js에는 없음) ──
export async function listPendingAccountingEmployees() {
  return clone(employees.filter((e) => !e.accountingConfirmed));
}

export async function listAllEmployees() {
  return clone(employees);
}

export async function listAttendanceByStore(storeCode) {
  return clone(attendance.filter((a) => a.storeCode === storeCode));
}
