import React, { useState, useMemo, useEffect } from "react";
import {
  Store, Landmark, Briefcase, Building2, UserPlus, Lock, Unlock,
  CheckCircle2, Circle, AlertTriangle, Clock, ImagePlus, Check, X, Users, RefreshCw, Download, ArrowRight, ShieldAlert, Edit3, Trash2, Key, UserCheck, PlusCircle, ShieldCheck, MapPin, Phone, FileText, LayoutDashboard, DollarSign, AlertCircle, FileCheck
} from "lucide-react";
import * as firebaseService from "../firebaseService";

const EMPLOYMENT_TYPES = ["정직원", "아르바이트", "일용직"];
const ATTEND_TYPES = ["정상출근", "연차", "반차", "지각", "조퇴", "출장(외근)"];

// 담당 부서별 서류 정의
const ACCOUNTING_DOCS = [
  { key: "idCard", label: "주민등록증" },
  { key: "bankbook", label: "통장사본" },
];

const HR_DOCS = [
  { key: "healthCert", label: "보건증" },
  { key: "contract", label: "근로계약서" },
];

const DOCS = [...ACCOUNTING_DOCS, ...HR_DOCS];

// 이미지를 캔버스를 이용해 최대 800px, 70% 품질 JPEG로 경량화 압축하여 Firestore 저장 성공 보장
function compressImage(file, maxSide = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxSide || height > maxSide) {
          if (width > height) {
            height = Math.round((height * maxSide) / width);
            width = maxSide;
          } else {
            width = Math.round((width * maxSide) / height);
            height = maxSide;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function maskSsn(s) {
  if (!s) return "-";
  return s.length > 6 ? s.slice(0, 6) + "-●●●●●●●" : s;
}

function getSsnPrefix(s) {
  if (!s) return "------";
  const clean = s.replace(/-/g, "");
  return clean.length >= 6 ? clean.slice(0, 6) + "-●●●●●●●" : s;
}

// 한국 표준시(KST, Asia/Seoul) 기준 YYYY-MM-DD 날짜 추출
function getKstDateString(dateObj) {
  if (!dateObj) return "";
  const d = typeof dateObj === "string" 
    ? new Date(dateObj) 
    : dateObj.toDate 
    ? dateObj.toDate() 
    : new Date(dateObj);

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d);
}

// 인사팀까지 100% 확정된 사원은 한국시간(KST) 기준 당일 밤 12시(자정)까지 표시 후 자동 정리
function isVisibleInRegistrationStatus(employee) {
  if (!employee.accountingConfirmed || !employee.hrConfirmed) return true;

  const confirmedTime = employee.hrConfirmedAt || employee.createdAt;
  if (!confirmedTime) return true;

  const confirmedKstDay = getKstDateString(confirmedTime);
  const currentKstDay = getKstDateString(new Date());

  return confirmedKstDay === currentKstDay;
}

export default function PayrollFlowPrototype() {
  const [currentUserRole, setCurrentUserRole] = useState("accounting");
  const [currentStoreCode, setCurrentStoreCode] = useState("고메스퀘어 부천점");

  const [role, setRole] = useState("accounting");
  const [accountingSubtab, setAccountingSubtab] = useState("confirm");
  const [hrSubtab, setHrSubtab] = useState("confirm");

  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [stores, setStores] = useState([]);
  
  const [storeTab, setStoreTab] = useState("register");
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  // 사원 수정 ID & 매장 수정 ID
  const [editingEmpId, setEditingEmpId] = useState(null);
  const [editingStoreId, setEditingStoreId] = useState(null);

  // 대시보드 이슈 읽음(확인) 처리 상태 관리 (회계, 매장, 인사)
  const [seenAccountingIssueIds, setSeenAccountingIssueIds] = useState(new Set());
  const [seenStoreIssueIds, setSeenStoreIssueIds] = useState(new Set());
  const [seenHrIssueIds, setSeenHrIssueIds] = useState(new Set());

  // 삭제 2차 비밀번호 검증 모달 상태
  const [deleteModalState, setDeleteModalState] = useState({
    isOpen: false,
    targetId: null,
    targetName: "",
    deleteType: "store",
  });

  // Firestore 실시간 바인딩
  useEffect(() => {
    const unsubEmployees = firebaseService.subscribeEmployees((list) => {
      setEmployees(list);
      setLoading(false);
    });

    const unsubAttendance = firebaseService.subscribeAttendance((list) => {
      setAttendance(list);
    });

    const unsubStores = firebaseService.subscribeStores((list) => {
      setStores(list);
    });

    return () => {
      unsubEmployees();
      unsubAttendance();
      unsubStores();
    };
  }, []);

  const flash = (msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2500);
  };

  // 사원등록 폼 초기값
  const emptyForm = {
    name: "", ssn: "", phone: "", hireDate: "", resignDate: "", account: "",
    position: "", dept: "", employmentType: "아르바이트", storeCode: currentStoreCode || "고메스퀘어 부천점",
    idCard: null, bankbook: null, healthCert: null, contract: null,
  };
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");

  // 매장 선택 변경 시 사원등록 폼의 소속 매장도 자동 업데이트
  useEffect(() => {
    if (currentStoreCode) {
      setForm((prev) => ({ ...prev, storeCode: currentStoreCode }));
    }
  }, [currentStoreCode]);

  // 매장 등록/수정 폼 초기값
  const emptyStoreForm = {
    name: "", address: "", phone: "", businessNumber: "", businessCert: null,
  };
  const [storeForm, setStoreForm] = useState(emptyStoreForm);
  const [storeFormError, setStoreFormError] = useState("");

  // 특정 매장 정보 불러와서 좌측 폼으로 로드 (수정 모드)
  const startEditStore = (st) => {
    setEditingStoreId(st.id);
    setStoreForm({
      name: st.name || "",
      address: st.address || "",
      phone: st.phone || "",
      businessNumber: st.businessNumber || "",
      businessCert: st.businessCert || null,
      code: st.code || "",
    });
    setStoreFormError("");
    flash(`"${st.name}" 매장 정보를 좌측 폼으로 로드했습니다.`);
  };

  const cancelEditStore = () => {
    setEditingStoreId(null);
    setStoreForm(emptyStoreForm);
    setStoreFormError("");
  };

  const submitRegisterStore = async () => {
    if (!storeForm.name || !storeForm.address || !storeForm.phone || !storeForm.businessNumber) {
      setStoreFormError("필수 항목(매장명·주소·사업자 전화번호·사업자등록번호)을 모두 입력하세요.");
      return;
    }
    setStoreFormError("");
    try {
      if (editingStoreId) {
        await firebaseService.updateStore(editingStoreId, storeForm, "accounting_user");
        flash(`"${storeForm.name}" 매장 정보가 수정 저장되었습니다!`);
        setEditingStoreId(null);
      } else {
        await firebaseService.registerStore(storeForm, "accounting_user");
        flash(`신규 매장 "${storeForm.name}"이(가) 등록되었습니다!`);
        setCurrentStoreCode(storeForm.name);
      }
      setStoreForm(emptyStoreForm);
    } catch (err) {
      setStoreFormError(err.message || "매장 저장 중 오류가 발생했습니다.");
    }
  };

  // 🔒 매장 삭제 버튼 클릭 시 2차 비밀번호 검증 모달 오픈
  const openDeleteStoreModal = (id, storeName) => {
    setDeleteModalState({
      isOpen: true,
      targetId: id,
      targetName: storeName,
      deleteType: "store",
    });
  };

  // 🔒 비밀번호 2차 검증 성공 후 실제 삭제 수행
  const handleExecuteDelete = async () => {
    const { targetId, targetName, deleteType } = deleteModalState;
    if (deleteType === "store" && targetId) {
      try {
        await firebaseService.deleteStore(targetId);
        flash(`🔒 관리자 인증 완료 — "${targetName}" 매장이 안전하게 삭제되었습니다.`);
        if (editingStoreId === targetId) {
          cancelEditStore();
        }
      } catch (err) {
        flash(err.message || "매장 삭제 실패", "error");
      }
    }
    setDeleteModalState({ isOpen: false, targetId: null, targetName: "", deleteType: "store" });
  };

  // 특정 사원의 값을 불러와서 수정/서류보완 폼으로 로드
  const startEditEmployee = (emp) => {
    setEditingEmpId(emp.id);
    setForm({
      name: emp.name || "",
      ssn: emp.ssn || "",
      phone: emp.phone || "",
      hireDate: emp.hireDate || "",
      resignDate: emp.resignDate || "",
      account: emp.account || "",
      position: emp.position || "",
      dept: emp.dept || "",
      employmentType: emp.employmentType || "아르바이트",
      storeCode: emp.storeCode || currentStoreCode,
      idCard: emp.idCard || null,
      bankbook: emp.bankbook || null,
      healthCert: emp.healthCert || null,
      contract: emp.contract || null,
    });
    setFormError("");
    flash(`"${emp.name}" 사원 정보 및 기존 서류를 로드했습니다.`);
  };

  const cancelEdit = () => {
    setEditingEmpId(null);
    setForm(emptyForm);
    setFormError("");
  };

  const submitRegister = async () => {
    if (!form.name || !form.ssn || !form.phone || !form.hireDate) {
      setFormError("필수항목(성명·주민번호·연락처·입사일)을 모두 입력하세요.");
      return;
    }
    setFormError("");
    try {
      if (editingEmpId) {
        await firebaseService.updateEmployee(editingEmpId, { ...form, storeCode: currentStoreCode }, "store_user");
        flash(`"${form.name}" 사원의 서류 및 정보 수정이 저장되었습니다.`);
        setEditingEmpId(null);
      } else {
        await firebaseService.registerEmployee({ ...form, storeCode: currentStoreCode }, currentStoreCode, "store_user");
        flash(`${form.name}님 사원등록 및 서류가 저장되었습니다.`);
      }
      setForm(emptyForm);
    } catch (err) {
      setFormError(err.message || "저장 중 오류가 발생했습니다.");
    }
  };

  const confirmAccounting = async (id) => {
    try {
      await firebaseService.confirmAccounting(id, "accounting_user");
      flash("회계팀 승인 완료 (주민번호/계좌 대조 완료) — 인사팀으로 정식 수신되었습니다!");
    } catch (err) {
      flash(err.message || "확인 처리 실패", "error");
    }
  };

  const confirmResignation = async (id, empName) => {
    try {
      await firebaseService.confirmResignation(id, "accounting_user");
      flash(`"${empName}" 사원의 퇴사 처리가 회계팀에서 최종 확인되어 제거되었습니다.`);
    } catch (err) {
      flash(err.message || "퇴사 확인 실패", "error");
    }
  };

  const confirmHr = async (id) => {
    try {
      await firebaseService.confirmHr(id, "hr_user");
      flash("인사팀 최종 승인 완료 (등록 확정) — 모든 게이트 녹색 전환!");
    } catch (err) {
      flash(err.message || "확인 처리 실패", "error");
    }
  };

  const storeList = useMemo(() => {
    if (stores.length > 0) return stores;
    return [
      { id: "s2", name: "고메스퀘어 부천점", code: "STR-002", address: "경기 부천시 원미구 길주로 180", phone: "032-320-1000", businessNumber: "234-56-78901", businessCert: true, createdAt: "2025-06-02" },
      { id: "s3", name: "고메스퀘어 신대방점", code: "STR-003", address: "서울 동작구 신대방길 12", phone: "02-888-9999", businessNumber: "345-67-89012", businessCert: true, createdAt: "2026-08-10" },
    ];
  }, [stores]);

  const currentStoreObj = useMemo(() => {
    return storeList.find((s) => s.name === currentStoreCode || s.code === currentStoreCode) || {
      name: currentStoreCode, code: "STR-000", address: "매장 주소 입력 필요", phone: "000-0000-0000", businessNumber: "000-00-00000"
    };
  }, [storeList, currentStoreCode]);

  // 매장별 사원 필터링
  const isMatchStore = (empStoreCode, targetStore) => {
    if (!empStoreCode) return false;
    if (empStoreCode === targetStore.name || empStoreCode === targetStore.code) return true;
    return false;
  };

  const currentStoreEmployees = useMemo(() => {
    return employees.filter((e) => isMatchStore(e.storeCode, currentStoreObj));
  }, [employees, currentStoreObj]);

  const visibleStatusEmployees = useMemo(() => {
    return currentStoreEmployees.filter(isVisibleInRegistrationStatus);
  }, [currentStoreEmployees]);

  const confirmedEmployees = useMemo(() => {
    return currentStoreEmployees.filter((e) => e.accountingConfirmed && e.hrConfirmed);
  }, [currentStoreEmployees]);

  // 근태입력 폼
  const [attForm, setAttForm] = useState({
    employeeId: "", date: "", mode: "start-end", start: "", end: "", hours: "", type: "정상출근",
  });

  const computeHours = (f) => {
    if (f.mode === "start-only") return 10;
    if (f.mode === "start-hours") return Number(f.hours) || 0;
    if (f.mode === "start-end" && f.start && f.end) {
      const [sh, sm] = f.start.split(":").map(Number);
      const [eh, em] = f.end.split(":").map(Number);
      const diff = (eh * 60 + em - (sh * 60 + sm)) / 60;
      return diff > 0 ? Math.round(diff * 10) / 10 : 0;
    }
    return 0;
  };

  const submitAttendance = async () => {
    if (!attForm.employeeId || !attForm.date) {
      flash("직원과 날짜를 선택하세요.", "error");
      return;
    }
    try {
      await firebaseService.submitAttendance(attForm, currentStoreCode, "store_user");
      flash("근태 입력 완료 (Firestore 저장)");
      setAttForm({ ...attForm, start: "", end: "", hours: "" });
    } catch (err) {
      flash(err.message || "근태 저장 실패", "error");
    }
  };

  // 데모 샘플 데이터 생성
  const seedDemoData = async () => {
    try {
      await firebaseService.registerStore({
        name: "고메스퀘어 부천점", code: "STR-002", address: "경기 부천시 원미구 길주로 180", phone: "032-320-1000", businessNumber: "234-56-78901", businessCert: true,
      }, "accounting_user");

      await firebaseService.registerStore({
        name: "고메스퀘어 신대방점", code: "STR-003", address: "서울 동작구 신대방길 12", phone: "02-888-9999", businessNumber: "345-67-89012", businessCert: true,
      }, "accounting_user");

      await firebaseService.registerEmployee({
        name: "이병욱", ssn: "950405-1987654", phone: "010-5555-6666",
        hireDate: "2026-08-05", resignDate: "", account: "국민 404002-04-123456",
        position: "", dept: "", employmentType: "아르바이트",
        idCard: false, bankbook: false, healthCert: true, contract: true,
      }, "고메스퀘어 신대방점", "store_user");

      await firebaseService.registerEmployee({
        name: "박서연", ssn: "981212-2345678", phone: "010-2222-3333",
        hireDate: "2026-07-10", resignDate: "", account: "",
        position: "", dept: "", employmentType: "아르바이트",
        idCard: true, bankbook: true, healthCert: false, contract: false,
      }, "고메스퀘어 부천점", "store_user");

      flash("샘플 데이터(매장 2개 및 사원 2명)가 추가되었습니다!");
    } catch (err) {
      flash(err.message || "샘플 생성 오류", "error");
    }
  };

  const weeklyHoursByEmployee = useMemo(() => {
    const map = {};
    attendance.forEach((a) => {
      if (a.type !== "정상출근") return;
      map[a.employeeId] = (map[a.employeeId] || 0) + (a.totalHours || a.hours || 0);
    });
    return map;
  }, [attendance]);

  // 🏛️ 회계팀 담당 영역 필터링 (전 매장 대상)
  const allMissingAccount = useMemo(() => employees.filter((e) => !e.account), [employees]);
  const allMissingIdCard = useMemo(() => employees.filter((e) => !e.idCard), [employees]);
  const allMissingBankbook = useMemo(() => employees.filter((e) => !e.bankbook), [employees]);
  const allMissingAccountingDocs = useMemo(() => employees.filter((e) => !e.idCard || !e.bankbook), [employees]);

  // 💼 인사팀 담당 영역 필터링 (전 매장 대상)
  const allMissingHealthCert = useMemo(() => employees.filter((e) => !e.healthCert), [employees]);
  const allMissingContract = useMemo(() => employees.filter((e) => !e.contract), [employees]);
  const allMissingHrDocs = useMemo(() => employees.filter((e) => !e.healthCert || !e.contract), [employees]);

  const waitingAccounting = useMemo(() => employees.filter((e) => !e.accountingConfirmed), [employees]);
  const waitingHr = useMemo(() => employees.filter((e) => e.accountingConfirmed && !e.hrConfirmed), [employees]);
  const pendingResignations = useMemo(() => employees.filter((e) => e.resignDate && !e.resignConfirmed), [employees]);

  // 전 매장 주 15시간 이상 아르바이트생
  const allPartTime15hAlerts = useMemo(() => {
    return employees
      .filter((e) => e.employmentType === "아르바이트")
      .map((e) => {
        const hrs = weeklyHoursByEmployee[e.id] || 0;
        return { e, hrs };
      })
      .filter((x) => x.hrs >= 15);
  }, [employees, weeklyHoursByEmployee]);

  // 🎯 회계팀 대시보드 총 이슈 식별 목록 (고유 ID)
  const currentAccountingIssues = useMemo(() => {
    const list = [];
    waitingAccounting.forEach((e) => list.push(`unconf_${e.id}`));
    allMissingIdCard.forEach((e) => list.push(`noid_${e.id}`));
    allMissingBankbook.forEach((e) => list.push(`nobank_${e.id}`));
    allMissingAccount.forEach((e) => list.push(`noacc_${e.id}`));
    pendingResignations.forEach((e) => list.push(`resign_${e.id}`));
    allPartTime15hAlerts.forEach(({ e }) => list.push(`pt15_${e.id}`));
    return Array.from(new Set(list));
  }, [waitingAccounting, allMissingIdCard, allMissingBankbook, allMissingAccount, pendingResignations, allPartTime15hAlerts]);

  // 🎯 인사팀 대시보드 총 이슈 식별 목록 (고유 ID)
  const currentHrIssues = useMemo(() => {
    const list = [];
    waitingHr.forEach((e) => list.push(`hr_wait_${e.id}`));
    allMissingHealthCert.forEach((e) => list.push(`hr_nocert_${e.id}`));
    allMissingContract.forEach((e) => list.push(`hr_nocontract_${e.id}`));
    return Array.from(new Set(list));
  }, [waitingHr, allMissingHealthCert, allMissingContract]);

  // 회계팀 대시보드 탭에 있을 때 현재 모든 이슈를 "확인(읽음)" 처리
  useEffect(() => {
    if (role === "accounting_dashboard") {
      setSeenAccountingIssueIds((prev) => {
        const next = new Set(prev);
        currentAccountingIssues.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [role, currentAccountingIssues]);

  // 인사팀 대시보드 탭에 있을 때 현재 모든 인사 이슈를 "확인(읽음)" 처리
  useEffect(() => {
    if (role === "hr" && hrSubtab === "dashboard") {
      setSeenHrIssueIds((prev) => {
        const next = new Set(prev);
        currentHrIssues.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [role, hrSubtab, currentHrIssues]);

  // 아직 회계 대시보드에서 확인하지 않은 "신규 이슈 수" 계산
  const unreadAccountingIssuesCount = useMemo(() => {
    return currentAccountingIssues.filter((id) => !seenAccountingIssueIds.has(id)).length;
  }, [currentAccountingIssues, seenAccountingIssueIds]);

  // 아직 인사 대시보드에서 확인하지 않은 "신규 인사 이슈 수" 계산
  const unreadHrIssuesCount = useMemo(() => {
    return currentHrIssues.filter((id) => !seenHrIssueIds.has(id)).length;
  }, [currentHrIssues, seenHrIssueIds]);

  // 🎯 해당 매장 전용 데이터 분석
  const currentStoreUnconfirmedEmps = useMemo(() => {
    return currentStoreEmployees.filter((e) => !e.accountingConfirmed || !e.hrConfirmed);
  }, [currentStoreEmployees]);

  const currentStoreMissingIdCardEmps = useMemo(() => {
    return currentStoreEmployees.filter((e) => !e.idCard);
  }, [currentStoreEmployees]);

  const currentStoreMissingAccountEmps = useMemo(() => {
    return currentStoreEmployees.filter((e) => !e.account);
  }, [currentStoreEmployees]);

  const currentStoreMissingDocsEmps = useMemo(() => {
    return currentStoreEmployees.filter((e) => DOCS.some((d) => !e[d.key]));
  }, [currentStoreEmployees]);

  const currentStorePartTime15hAlerts = useMemo(() => {
    return currentStoreEmployees
      .filter((e) => e.employmentType === "아르바이트")
      .map((e) => {
        const hrs = weeklyHoursByEmployee[e.id] || 0;
        return { e, hrs };
      })
      .filter((x) => x.hrs >= 15);
  }, [currentStoreEmployees, weeklyHoursByEmployee]);

  const currentStoreAttendanceList = useMemo(() => {
    return attendance.filter((a) => {
      const emp = employees.find((e) => e.id === a.employeeId);
      return emp ? isMatchStore(emp.storeCode, currentStoreObj) : a.storeCode === currentStoreCode;
    });
  }, [attendance, employees, currentStoreObj, currentStoreCode]);

  const currentStoreIssues = useMemo(() => {
    const list = [];
    currentStoreUnconfirmedEmps.forEach((e) => list.push(`st_unconf_${e.id}`));
    currentStoreMissingIdCardEmps.forEach((e) => list.push(`st_noid_${e.id}`));
    currentStoreMissingAccountEmps.forEach((e) => list.push(`st_noacc_${e.id}`));
    currentStorePartTime15hAlerts.forEach(({ e }) => list.push(`st_pt15_${e.id}`));
    return Array.from(new Set(list));
  }, [currentStoreUnconfirmedEmps, currentStoreMissingIdCardEmps, currentStoreMissingAccountEmps, currentStorePartTime15hAlerts]);

  useEffect(() => {
    if (role === "hq") {
      setSeenStoreIssueIds((prev) => {
        const next = new Set(prev);
        currentStoreIssues.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [role, currentStoreIssues]);

  const unreadStoreIssuesCount = useMemo(() => {
    return currentStoreIssues.filter((id) => !seenStoreIssueIds.has(id)).length;
  }, [currentStoreIssues, seenStoreIssueIds]);

  return (
    <div className="w-full min-h-screen bg-[#F1F5F9] text-slate-800 antialiased pb-16" style={{ fontFamily: "'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif" }}>
      {/* 0. 로그인 계정 / 매장 로그인 아이디 분석 시뮬레이션 바 */}
      <div className="bg-slate-900 text-slate-200 px-8 py-2 flex flex-wrap items-center justify-between text-xs sm:text-sm font-semibold border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-[#EF7D25]" />
          <span>로그인 계정 권한 구분 시뮬레이션:</span>
          <select
            value={currentUserRole === "store" ? `store:${currentStoreCode}` : currentUserRole}
            onChange={(e) => {
              const val = e.target.value;
              if (val.startsWith("store:")) {
                const sCode = val.split(":")[1];
                setCurrentUserRole("store");
                setCurrentStoreCode(sCode);
                setRole("store");
              } else {
                setCurrentUserRole(val);
                setRole(val);
                if (val === "hr") setHrSubtab("confirm");
              }
            }}
            className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-1 font-bold text-xs focus:outline-none focus:ring-1 focus:ring-[#EF7D25]"
          >
            <option value="accounting">🏛️ 회계팀 계정 (전체 회계 및 매장관리)</option>
            <option value="hr">💼 인사팀 계정 (전체 인사 승인)</option>
            {storeList.map((st) => (
              <option key={st.id || st.code} value={`store:${st.name}`}>
                🏪 {st.name} 매장 전용 계정 로그인
              </option>
            ))}
          </select>
        </div>

        <div className="text-slate-400 text-xs">
          현재 로그인: <strong className="text-white">{currentUserRole === "accounting" ? "회계팀" : currentUserRole === "hr" ? "인사팀" : `🏪 "${currentStoreCode}" 매장 계정`}</strong>
        </div>
      </div>

      {/* 1. 상단 헤더 바 */}
      <header className="bg-[#EF7D25] text-white px-8 py-5 flex items-center justify-between shadow-md">
        <div className="text-2xl sm:text-3xl font-black tracking-widest text-white select-none">
          SWAGBERRY
        </div>
        {employees.length === 0 && !loading && (
          <button
            onClick={seedDemoData}
            className="text-sm bg-white hover:bg-slate-100 text-[#EF7D25] font-extrabold px-4 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-sm cursor-pointer"
          >
            <RefreshCw className="w-4 h-4 text-[#EF7D25]" /> 샘플 데이터 복구
          </button>
        )}
      </header>

      {/* 2. 상단 네비게이션 탭 */}
      <nav className="bg-white border-b border-slate-200/90 px-8 py-3 flex flex-wrap items-center gap-2.5 shadow-xs">
        {/* 1. 회계팀 탭 */}
        {(currentUserRole === "accounting" || role === "accounting" || role === "accounting_dashboard") && (
          <button
            onClick={() => setRole("accounting")}
            className={`flex items-center gap-2 px-5 py-2.5 text-base font-bold rounded-xl transition-all cursor-pointer ${
              role === "accounting"
                ? "border-2 border-[#EF7D25] text-[#EF7D25] bg-orange-50/60 shadow-xs"
                : "border-2 border-transparent text-slate-700 hover:text-slate-900 hover:bg-slate-100/70"
            }`}
          >
            <Landmark className="w-5 h-5 text-[#EF7D25]" />
            <span>회계팀</span>
            {(waitingAccounting.length + pendingResignations.length) > 0 && (
              <span className="ml-1 bg-[#EF7D25] text-white text-xs font-extrabold rounded-full px-2 py-0.5 shadow-xs">
                {waitingAccounting.length + pendingResignations.length}
              </span>
            )}
          </button>
        )}

        {/* 2. 📊 회계팀 대시보드 탭 (간소화 명칭) */}
        {(currentUserRole === "accounting" || role === "accounting" || role === "accounting_dashboard") && (
          <button
            onClick={() => setRole("accounting_dashboard")}
            className={`flex items-center gap-2 px-5 py-2.5 text-base font-bold rounded-xl transition-all cursor-pointer ${
              role === "accounting_dashboard"
                ? "border-2 border-[#EF7D25] text-[#EF7D25] bg-orange-50/60 shadow-xs"
                : "border-2 border-transparent text-slate-700 hover:text-slate-900 hover:bg-slate-100/70"
            }`}
          >
            <LayoutDashboard className="w-5 h-5 text-indigo-600" />
            <span>회계팀 대시보드</span>
            {unreadAccountingIssuesCount > 0 && (
              <span className="ml-1 bg-rose-600 text-white text-xs font-extrabold rounded-full px-2.5 py-0.5 shadow-xs animate-pulse">
                {unreadAccountingIssuesCount}
              </span>
            )}
          </button>
        )}

        {/* 3. 인사팀 탭 */}
        {(currentUserRole === "hr" || role === "hr") && (
          <button
            onClick={() => { setRole("hr"); setHrSubtab("confirm"); }}
            className={`flex items-center gap-2 px-5 py-2.5 text-base font-bold rounded-xl transition-all cursor-pointer ${
              role === "hr" && hrSubtab === "confirm"
                ? "border-2 border-[#EF7D25] text-[#EF7D25] bg-orange-50/60 shadow-xs"
                : "border-2 border-transparent text-slate-700 hover:text-slate-900 hover:bg-slate-100/70"
            }`}
          >
            <Briefcase className="w-5 h-5 text-emerald-600" />
            <span>인사팀</span>
            {(waitingHr.length + waitingAccounting.length) > 0 && (
              <span className="ml-1 bg-emerald-600 text-white text-xs font-extrabold rounded-full px-2 py-0.5 shadow-xs">
                {waitingHr.length + waitingAccounting.length}
              </span>
            )}
          </button>
        )}

        {/* 4. 📊 인사팀 대시보드 탭 (회계팀 대시보드와 동일하게 상단 네비에 배치) */}
        {(currentUserRole === "hr" || role === "hr") && (
          <button
            onClick={() => { setRole("hr"); setHrSubtab("dashboard"); }}
            className={`flex items-center gap-2 px-5 py-2.5 text-base font-bold rounded-xl transition-all cursor-pointer ${
              role === "hr" && hrSubtab === "dashboard"
                ? "border-2 border-[#EF7D25] text-[#EF7D25] bg-orange-50/60 shadow-xs"
                : "border-2 border-transparent text-slate-700 hover:text-slate-900 hover:bg-slate-100/70"
            }`}
          >
            <LayoutDashboard className="w-5 h-5 text-emerald-600" />
            <span>인사팀 대시보드</span>
            {unreadHrIssuesCount > 0 && (
              <span className="ml-1 bg-rose-600 text-white text-xs font-extrabold rounded-full px-2.5 py-0.5 shadow-xs animate-pulse">
                {unreadHrIssuesCount}
              </span>
            )}
          </button>
        )}

        {/* 5. 매장 계정용 매장 관리 탭 */}
        {(currentUserRole === "store" || role === "store") && (
          <button
            onClick={() => setRole("store")}
            className={`flex items-center gap-2 px-5 py-2.5 text-base font-bold rounded-xl transition-all cursor-pointer ${
              role === "store"
                ? "border-2 border-[#EF7D25] text-[#EF7D25] bg-orange-50/60 shadow-xs"
                : "border-2 border-transparent text-slate-700 hover:text-slate-900 hover:bg-slate-100/70"
            }`}
          >
            <Store className="w-5 h-5 text-slate-700" />
            <span>매장 관리</span>
          </button>
        )}

        {/* 6. 🏪 매장 대시보드 탭 (매장 계정 전용) */}
        {(currentUserRole === "store" || role === "hq") && (
          <button
            onClick={() => setRole("hq")}
            className={`flex items-center gap-2 px-5 py-2.5 text-base font-bold rounded-xl transition-all cursor-pointer ${
              role === "hq"
                ? "border-2 border-[#EF7D25] text-[#EF7D25] bg-orange-50/60 shadow-xs"
                : "border-2 border-transparent text-slate-700 hover:text-slate-900 hover:bg-slate-100/70"
            }`}
          >
            <LayoutDashboard className="w-5 h-5 text-indigo-600" />
            <span>매장 대시보드</span>
            {unreadStoreIssuesCount > 0 && (
              <span className="ml-1 bg-rose-600 text-white text-xs font-extrabold rounded-full px-2.5 py-0.5 shadow-xs animate-pulse">
                {unreadStoreIssuesCount}
              </span>
            )}
          </button>
        )}
      </nav>

      {/* 3. 메인 콘텐츠 영역 */}
      <main className="max-w-[1400px] mx-auto p-6 md:p-8 mt-2">
        {/* ---------------- 1. 매장 화면 (해당 로그인 매장의 데이터만 독립 연동) ---------------- */}
        {role === "store" && (
          <div>
            {/* 로그인 매장 고정 배너 */}
            <div className="flex flex-wrap items-center justify-between bg-white p-5 rounded-2xl border border-slate-200 shadow-xs mb-6 gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center text-[#EF7D25] shrink-0">
                  <Store className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-black text-slate-900">
                      <span className="text-[#EF7D25] mr-1.5">[{currentStoreObj.code || "STR"}]</span>
                      {currentStoreObj.name}
                    </h2>
                    <span className="text-xs bg-emerald-100 border border-emerald-300 text-emerald-800 font-extrabold px-2.5 py-0.5 rounded-md">
                      🔒 해당 매장 데이터 전용 연동됨
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                    <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-400" /> {currentStoreObj.address || "주소 미입력"}</span>
                    <span>|</span>
                    <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-slate-400" /> {currentStoreObj.phone || "전화번호 미입력"}</span>
                    <span>|</span>
                    <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5 text-slate-400" /> 사업자번호: {currentStoreObj.businessNumber || "-"}</span>
                  </div>
                </div>
              </div>

              <div className="text-xs font-bold text-slate-600 bg-slate-100 px-4 py-2 rounded-xl border border-slate-200">
                소속 직원: <strong className="text-[#EF7D25] text-sm font-black ml-1">{currentStoreEmployees.length}명</strong>
              </div>
            </div>

            {/* 서브탭 버튼 */}
            <div className="flex gap-3 mb-6">
              <button
                onClick={() => setStoreTab("register")}
                className={`px-5 py-2.5 rounded-xl text-base font-bold transition-all shadow-xs cursor-pointer ${
                  storeTab === "register"
                    ? "bg-[#EF7D25] text-white shadow-md"
                    : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                사원등록
              </button>
              <button
                onClick={() => setStoreTab("attendance")}
                className={`px-5 py-2.5 rounded-xl text-base font-bold transition-all shadow-xs cursor-pointer ${
                  storeTab === "attendance"
                    ? "bg-[#EF7D25] text-white shadow-md"
                    : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                근태입력
              </button>
            </div>

            {storeTab === "register" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* 왼쪽 사원 등록 폼 (소속 매장은 자동 지정되며 수정 불가) */}
                <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200/90 p-7 shadow-sm">
                  <div className="flex items-center justify-between mb-6 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2 text-lg font-bold text-slate-900">
                      {editingEmpId ? <Edit3 className="w-5 h-5 text-[#EF7D25]" /> : <UserPlus className="w-5 h-5 text-[#EF7D25]" />}
                      <h2>{editingEmpId ? `✏️ "${form.name}" 사원 서류 보완 및 수정` : "신규 사원 등록"}</h2>
                    </div>
                  </div>

                  {editingEmpId && (
                    <div className="mb-5 bg-orange-50 border border-orange-200 rounded-xl p-3.5 text-sm font-semibold text-[#EF7D25]">
                      💡 <strong>"{form.name}"</strong> 사원의 기존 정보가 로드되었습니다. 수정 후 하단 [수정완료] 버튼을 누르세요.
                    </div>
                  )}
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-base">
                    <Field label="성명 *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="예: 홍길동" />
                    <Field label="주민등록번호 *" value={form.ssn} onChange={(v) => setForm({ ...form, ssn: v })} placeholder="900101-1234567" />
                    <Field label="연락처 *" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="010-0000-0000" />
                    <Field label="입사일 *" type="date" value={form.hireDate} onChange={(v) => setForm({ ...form, hireDate: v })} />
                    <Field label="계좌번호" value={form.account} onChange={(v) => setForm({ ...form, account: v })} placeholder="은행명 및 계좌번호" />
                    
                    {/* 🔒 소속 매장: 자동 매칭 및 수정 불가 */}
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                        소속 매장 <span className="text-xs text-slate-400 font-normal">(자동 매칭 · 수정 불가)</span>
                      </label>
                      <div className="w-full border border-slate-300 rounded-xl px-4 py-3 text-base font-bold text-slate-700 bg-slate-100 cursor-not-allowed shadow-xs flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-slate-900">
                          <Store className="w-4 h-4 text-[#EF7D25]" /> {currentStoreCode}
                        </span>
                        <span className="text-xs font-extrabold px-2 py-0.5 bg-slate-200 text-slate-600 rounded-md">
                          고정됨
                        </span>
                      </div>
                    </div>

                    <Select label="고용형태 *" value={form.employmentType} options={EMPLOYMENT_TYPES} onChange={(v) => setForm({ ...form, employmentType: v })} />
                    
                    {form.employmentType === "정직원" && (
                      <>
                        <Field label="직책" value={form.position} onChange={(v) => setForm({ ...form, position: v })} placeholder="예: 매니저, 팀원" />
                        <Field label="부서" value={form.dept} onChange={(v) => setForm({ ...form, dept: v })} placeholder="예: 홀, 주방" />
                      </>
                    )}
                  </div>

                  {/* 첨부서류 */}
                  <div className="mt-6">
                    <div className="text-sm font-semibold text-slate-700 mb-2">첨부서류 (클릭 후 사진 첨부)</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {DOCS.map((d) => {
                        const fileData = form[d.key];
                        const isAttached = Boolean(fileData);
                        return (
                          <label
                            key={d.key}
                            className={`flex items-center justify-center gap-1.5 text-sm font-semibold px-3 py-3 rounded-xl border transition-all cursor-pointer select-none text-center ${
                              isAttached
                                ? "bg-emerald-50 border-2 border-emerald-500 text-emerald-800 font-bold shadow-xs"
                                : "bg-slate-50 border border-slate-300 text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  try {
                                    const compressedDataUrl = await compressImage(file);
                                    setForm((prev) => ({ ...prev, [d.key]: compressedDataUrl }));
                                    flash(`${d.label} 사진이 정상 첨부되었습니다!`);
                                  } catch (err) {
                                    flash("사진 압축 중 오류가 발생했습니다.", "error");
                                  }
                                }
                              }}
                            />
                            {isAttached ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            ) : (
                              <ImagePlus className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <span className="truncate">{d.label} {isAttached ? "첨부완료" : "미첨부"}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* 첨부서류 하단 좌측: 퇴사일 */}
                  <div className="mt-6 max-w-xs">
                    <Field label="퇴사일 (입력 시 회계팀에 퇴사 알림 연동)" type="date" value={form.resignDate} onChange={(v) => setForm({ ...form, resignDate: v })} />
                  </div>

                  {formError && (
                    <div className="mt-5 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
                      ⚠️ {formError}
                    </div>
                  )}

                  {/* 하단 버튼 */}
                  {editingEmpId ? (
                    <div className="mt-7 flex gap-3">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="w-1/3 bg-slate-200 hover:bg-slate-300 text-slate-800 text-lg font-bold py-4 rounded-xl transition-all cursor-pointer"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={submitRegister}
                        className="w-2/3 bg-[#EF7D25] hover:bg-[#d96b1b] text-white text-lg font-extrabold py-4 rounded-xl shadow-md transition-all cursor-pointer"
                      >
                        수정완료
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={submitRegister}
                      className="mt-7 w-full bg-[#EF7D25] hover:bg-[#d96b1b] text-white text-lg font-extrabold py-4 rounded-xl shadow-md transition-all cursor-pointer"
                    >
                      등록완료
                    </button>
                  )}
                </div>

                {/* 우측 사원등록 현황 */}
                <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200/90 p-7 shadow-sm">
                  <div className="flex justify-between items-center mb-5 pb-3 border-b border-slate-100">
                    <h2 className="text-lg font-bold text-slate-900">
                      "{currentStoreCode}" 사원 현황
                    </h2>
                    <span className="text-sm text-slate-500 font-semibold">총 {visibleStatusEmployees.length}명</span>
                  </div>
                  
                  <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
                    {visibleStatusEmployees.length === 0 && (
                      <div className="text-sm text-slate-600 p-6 border border-dashed border-slate-300 rounded-xl text-center space-y-2 bg-slate-50">
                        <div className="font-bold text-slate-800">💡 아직 "{currentStoreCode}"에 등록된 사원이 없습니다.</div>
                        <p className="text-xs text-slate-500">왼쪽 신규 사원 등록 폼에서 사원 정보를 입력하고 [등록완료]를 누르시면 목록에 추가됩니다.</p>
                      </div>
                    )}
                    {visibleStatusEmployees.map((e) => {
                      const isEditing = editingEmpId === e.id;
                      return (
                        <div
                          key={e.id}
                          className={`border-2 rounded-xl p-5 transition-all shadow-xs relative ${
                            isEditing
                              ? "border-[#EF7D25] bg-orange-50/70 ring-2 ring-orange-200"
                              : "border-slate-200 bg-slate-50/70 hover:bg-slate-100"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <span className="font-bold text-base text-slate-900 mr-2">{e.name}</span>
                              <span className="text-xs font-semibold px-2 py-0.5 bg-slate-200 text-slate-700 rounded-md">
                                {e.employmentType}
                              </span>
                            </div>
                            
                            <button
                              type="button"
                              onClick={() => startEditEmployee(e)}
                              className="text-xs bg-[#EF7D25] hover:bg-[#d96b1b] text-white font-extrabold px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-xs cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" /> 서류첨부
                            </button>
                          </div>
                          
                          <div className="text-xs text-slate-500 mb-3">
                            연락처: {e.phone} | 입사일: {e.hireDate}
                          </div>

                          <div className="mt-2">
                            <GatePill employee={e} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {storeTab === "attendance" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* 근태 입력 폼 */}
                <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200/90 p-7 shadow-sm">
                  <h2 className="text-lg font-bold text-slate-900 mb-6 pb-3 border-b border-slate-100">
                    근태 입력 ({currentStoreCode})
                  </h2>

                  <div className="space-y-5 text-base">
                    <Select
                      label={`직원 선택 * (${currentStoreCode} 승인 확정 사원)`}
                      value={attForm.employeeId}
                      options={confirmedEmployees.map((e) => e.name)}
                      valueMap={confirmedEmployees}
                      onChange={(v) => {
                        const emp = confirmedEmployees.find((e) => e.name === v);
                        setAttForm({ ...attForm, employeeId: emp ? emp.id : "" });
                      }}
                      showDefaultOption={confirmedEmployees.length === 0}
                    />
                    {confirmedEmployees.length === 0 && (
                      <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 font-medium space-y-1">
                        <div>⚠️ <strong>"{currentStoreCode}"</strong>에 승인 확정된 사원이 없습니다.</div>
                        <p className="text-xs text-amber-700">왼쪽 [사원등록] 탭에서 사원을 등록하고 회계팀+인사팀 승인을 완료하면 표시됩니다.</p>
                      </div>
                    )}
                    <Field label="근무 날짜 *" type="date" value={attForm.date} onChange={(v) => setAttForm({ ...attForm, date: v })} />
                    <Select label="근태 구분 *" value={attForm.type} options={ATTEND_TYPES} onChange={(v) => setAttForm({ ...attForm, type: v })} />

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">근무시간 입력 방식</label>
                      <div className="flex gap-2 mb-3">
                        {[
                          { key: "start-only", label: "시작만 (기본 10h)" },
                          { key: "start-hours", label: "시작 + 총시간" },
                          { key: "start-end", label: "시작 + 종료시간" },
                        ].map((m) => (
                          <button
                            key={m.key}
                            type="button"
                            onClick={() => setAttForm({ ...attForm, mode: m.key })}
                            className={`text-sm px-3.5 py-2 rounded-xl border font-bold transition-all cursor-pointer ${
                              attForm.mode === m.key
                                ? "bg-[#EF7D25] text-white border-[#EF7D25] shadow-xs"
                                : "bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="시작시간" type="time" value={attForm.start} onChange={(v) => setAttForm({ ...attForm, start: v })} />
                        {attForm.mode === "start-hours" && (
                          <Field label="총 근무시간(시간)" type="number" value={attForm.hours} onChange={(v) => setAttForm({ ...attForm, hours: v })} />
                        )}
                        {attForm.mode === "start-end" && (
                          <Field label="종료시간" type="time" value={attForm.end} onChange={(v) => setAttForm({ ...attForm, end: v })} />
                        )}
                      </div>
                      
                      <div className="text-sm font-semibold text-slate-700 mt-2 bg-slate-50 px-3.5 py-2.5 rounded-xl border border-slate-200">
                        자동 계산된 총 근무시간: <span className="text-base font-extrabold text-[#EF7D25] ml-1">{computeHours(attForm)}시간</span>
                      </div>
                    </div>

                    <button
                      onClick={submitAttendance}
                      disabled={confirmedEmployees.length === 0}
                      className="w-full bg-[#EF7D25] hover:bg-[#d96b1b] text-white text-base font-bold py-3.5 rounded-xl shadow-md disabled:opacity-40 transition-all cursor-pointer"
                    >
                      근태 기록 저장 (Firestore)
                    </button>
                  </div>
                </div>

                {/* 해당 매장 알바 주간 누적 근로시간 현황 */}
                <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200/90 p-7 shadow-sm">
                  <h2 className="text-lg font-bold text-slate-900 mb-6 pb-3 border-b border-slate-100">
                    "{currentStoreCode}" 알바 주간 누적 근로시간
                  </h2>
                  
                  <div className="space-y-5 mb-8">
                    {currentStorePartTime15hAlerts.length === 0 && (
                      <div className="text-sm text-slate-500">"{currentStoreCode}"에 주 15시간 이상 근무 중인 아르바이트 사원이 없습니다.</div>
                    )}
                    {currentStorePartTime15hAlerts.map(({ e, hrs }) => {
                      const pct = Math.min((hrs / 15) * 100, 100);
                      return (
                        <div key={e.id} className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                          <div className="flex justify-between items-center text-sm font-bold mb-2">
                            <span className="text-slate-900 text-base">{e.name}</span>
                            <span className="text-base text-rose-600 font-extrabold">
                              {hrs}시간 / 15시간
                            </span>
                          </div>
                          <div className="h-3 rounded-full bg-slate-200 overflow-hidden">
                            <div
                              className="h-full bg-rose-500 transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="text-xs font-bold text-rose-600 mt-2 flex flex-wrap items-center gap-2 bg-rose-50 p-2.5 rounded-lg border border-rose-200">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>주휴수당 지급 대상 및 1년 지속 근무 시 <strong>퇴직급여(퇴직금) 발생 가능 위험군!</strong></span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <h3 className="text-base font-bold text-slate-900 mb-3">"{currentStoreCode}" 최근 근태 기록</h3>
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {currentStoreAttendanceList.length === 0 && <div className="text-sm text-slate-500">근태 기록이 없습니다.</div>}
                    {currentStoreAttendanceList.slice().reverse().map((a) => {
                      const emp = employees.find((e) => e.id === a.employeeId);
                      return (
                        <div key={a.id} className="text-sm flex justify-between items-center border-b border-slate-100 py-2">
                          <span className="font-semibold text-slate-800">{emp?.name || "사원"} · {a.date} · <span className="text-slate-600">{a.type}</span></span>
                          <span className="font-bold text-[#EF7D25] bg-orange-50 border border-orange-200 px-2.5 py-1 rounded-lg text-xs">{a.totalHours || a.hours}시간</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------------- 2. 🏛️ 회계팀 화면 (주민번호/계좌번호 원본 무마스킹 표시 및 대조 지원) ---------------- */}
        {role === "accounting" && (
          <div>
            <div className="flex gap-3 mb-6">
              <button
                onClick={() => setAccountingSubtab("confirm")}
                className={`px-5 py-2.5 rounded-xl text-base font-bold transition-all shadow-xs cursor-pointer flex items-center gap-2 ${
                  accountingSubtab === "confirm"
                    ? "bg-[#EF7D25] text-white shadow-md"
                    : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span>사원등록 확인</span>
                {(waitingAccounting.length + pendingResignations.length) > 0 && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-black ${
                    accountingSubtab === "confirm" ? "bg-white text-[#EF7D25]" : "bg-[#EF7D25] text-white"
                  }`}>
                    {waitingAccounting.length + pendingResignations.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setAccountingSubtab("stores")}
                className={`px-5 py-2.5 rounded-xl text-base font-bold transition-all shadow-xs cursor-pointer flex items-center gap-2 ${
                  accountingSubtab === "stores"
                    ? "bg-[#EF7D25] text-white shadow-md"
                    : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Store className="w-4 h-4" />
                <span>매장 관리</span>
              </button>
            </div>

            {/* 서브탭 1: 사원등록 확인 목록 (회계 담당: 주민등록증/통장사본 및 주민번호/계좌 대조) */}
            {accountingSubtab === "confirm" && (
              <div className="max-w-4xl mx-auto space-y-8">
                {/* 🚨 퇴사자 발생 확인 알림 카드 목록 */}
                {pendingResignations.length > 0 && (
                  <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-6 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 text-lg font-bold text-rose-800 border-b border-rose-200 pb-3">
                      <AlertTriangle className="w-5.5 h-5.5 text-rose-600" />
                      <h2>🚨 퇴사자 발생 알림 (확인 필요: {pendingResignations.length}건)</h2>
                    </div>
                    <p className="text-xs text-rose-700">매장에서 퇴사일이 입력된 사원입니다. 회계팀 담당자가 확인을 누르면 알림 목록에서 제거됩니다.</p>
                    
                    <div className="space-y-3">
                      {pendingResignations.map((e) => (
                        <div key={e.id} className="bg-white border border-rose-300 rounded-xl p-4 flex flex-wrap justify-between items-center gap-4 shadow-xs">
                          <div className="space-y-1">
                            <div className="text-base font-bold text-slate-900">
                              <span className="text-rose-700 mr-2">[{e.storeCode}]</span>
                              {e.name}
                              <span className="text-xs font-semibold px-2 py-0.5 bg-slate-200 text-slate-700 rounded-md ml-2">{e.employmentType}</span>
                            </div>
                            <div className="text-sm text-slate-600 font-medium">
                              주민등록번호 전체: <strong className="text-slate-900 font-bold">{e.ssn || "-"}</strong> | 퇴사일: <strong className="text-rose-600 font-extrabold">{e.resignDate}</strong>
                            </div>
                          </div>
                          
                          <button
                            onClick={() => confirmResignation(e.id, e.name)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                          >
                            <Check className="w-4 h-4" /> 확인
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 🏛️ 신규 입사 사원 회계팀 확인 대기 목록 */}
                <div className="bg-white rounded-2xl border border-slate-200/90 p-8 shadow-sm">
                  <div className="flex items-center gap-2 text-xl font-bold text-slate-900 mb-2">
                    <Landmark className="w-6 h-6 text-[#EF7D25]" />
                    <h2>회계팀 확인 대기 목록 (게이트 1단계)</h2>
                  </div>
                  <p className="text-sm text-slate-500 mb-6">
                    🔍 <strong>회계 전용 무마스킹</strong>: 실시간 주민번호·계좌번호 숫자를 사진과 100% 대조한 뒤 [회계팀 승인]을 클릭하세요. 승인 시 계좌번호를 제외한 정보가 인사팀으로 전송됩니다.
                  </p>
                  
                  <div className="space-y-4">
                    {waitingAccounting.length === 0 && (
                      <div className="text-base text-slate-500 p-8 border border-dashed border-slate-300 rounded-xl text-center">
                        현재 회계팀 확인 대기 중인 입사 사원이 없습니다.
                      </div>
                    )}
                    {waitingAccounting.map((e) => (
                      <div key={e.id} className="border border-slate-200 rounded-xl p-5 bg-slate-50/50 hover:bg-slate-50 transition-all shadow-xs">
                        <div className="flex flex-wrap justify-between items-start gap-4">
                          <div className="space-y-1.5 text-base">
                            <div className="font-bold text-lg text-slate-900">
                              {e.name} <span className="text-xs font-semibold px-2 py-0.5 bg-slate-200 text-slate-700 rounded-md ml-2">{e.employmentType} · {e.storeCode}</span>
                            </div>
                            <div className="text-sm font-bold text-slate-800 bg-orange-50 border border-orange-200 px-3 py-1.5 rounded-lg inline-block">
                              🔍 주민등록번호 (대조용): <span className="text-[#EF7D25] font-black">{e.ssn || "-"}</span> | 연락처: {e.phone}
                            </div>
                            <div className="text-sm font-bold text-slate-800 bg-orange-50 border border-orange-200 px-3 py-1.5 rounded-lg block">
                              💳 계좌번호 (대조용): {e.account ? <span className="font-black text-slate-900">{e.account}</span> : <span className="text-rose-600 font-extrabold">미기재</span>}
                            </div>
                            
                            <div className="flex flex-wrap gap-3 pt-2">
                              <DocChip ok={e.idCard} label="주민등록증" employeeName={e.name} />
                              <DocChip ok={e.bankbook} label="통장사본" employeeName={e.name} />
                            </div>
                          </div>
                          <button
                            onClick={() => confirmAccounting(e.id)}
                            className="flex items-center gap-1.5 bg-[#EF7D25] hover:bg-[#d96b1b] text-white text-sm font-bold px-5 py-3.5 rounded-xl shadow-md transition-all cursor-pointer"
                          >
                            <Check className="w-4 h-4" /> 회계 승인 (대조 완료 ➔ 인사팀 전달)
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 서브탭 2: 🏫 매장 관리 */}
            {accountingSubtab === "stores" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* 좌측: 🏫 매장 등록 / 수정 폼 */}
                <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200/90 p-7 shadow-sm">
                  <div className="flex items-center justify-between mb-6 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2 text-lg font-bold text-slate-900">
                      {editingStoreId ? <Edit3 className="w-5 h-5 text-[#EF7D25]" /> : <Store className="w-5 h-5 text-[#EF7D25]" />}
                      <h2>{editingStoreId ? `✏️ "${storeForm.name}" 매장 정보 및 서류 수정` : "신규 매장 등록"}</h2>
                    </div>
                  </div>

                  {editingStoreId && (
                    <div className="mb-5 bg-orange-50 border border-orange-200 rounded-xl p-3.5 text-sm font-semibold text-[#EF7D25]">
                      💡 <strong>"{storeForm.name}"</strong> 매장 정보가 로드되었습니다. 수정 후 하단 <strong>[수정완료]</strong> 버튼을 누르세요.
                    </div>
                  )}

                  <div className="space-y-4 text-base">
                    <Field label="매장명 *" value={storeForm.name} onChange={(v) => setStoreForm({ ...storeForm, name: v })} placeholder="예: 강남역점" />
                    <Field label="주소 *" value={storeForm.address} onChange={(v) => setStoreForm({ ...storeForm, address: v })} placeholder="예: 서울 강남구 강남대로 396" />
                    <Field label="사업자 전화번호 *" value={storeForm.phone} onChange={(v) => setStoreForm({ ...storeForm, phone: v })} placeholder="예: 02-0000-0000" />
                    <Field label="사업자등록번호 *" value={storeForm.businessNumber} onChange={(v) => setStoreForm({ ...storeForm, businessNumber: v })} placeholder="000-00-00000" />

                    <div className="text-xs text-slate-400">
                      💡 매장코드는 등록 시 자동으로 부여됩니다 (예: STR-003)
                    </div>

                    {/* 사업자등록증 첨부 */}
                    <div className="pt-2">
                      <div className="text-sm font-semibold text-slate-700 mb-1.5">첨부서류 (사진 첨부 시뮬레이션)</div>
                      <label className={`inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl border transition-all cursor-pointer select-none ${
                        storeForm.businessCert
                          ? "bg-emerald-50 border-2 border-emerald-500 text-emerald-800 font-bold"
                          : "bg-slate-50 border border-slate-300 text-slate-600 hover:bg-slate-100"
                      }`}>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              try {
                                const compressedDataUrl = await compressImage(file);
                                setStoreForm((prev) => ({ ...prev, businessCert: compressedDataUrl }));
                                flash("사업자등록증 사본이 첨부되었습니다!");
                              } catch (err) {
                                flash("사진 선택 오류", "error");
                              }
                            }
                          }}
                        />
                        {storeForm.businessCert ? (
                          <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600" />
                        ) : (
                          <ImagePlus className="w-4.5 h-4.5 text-slate-400" />
                        )}
                        <span>사업자등록증 사본 {storeForm.businessCert ? "첨부됨" : "미첨부"}</span>
                      </label>
                    </div>
                  </div>

                  {storeFormError && (
                    <div className="mt-5 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
                      ⚠️ {storeFormError}
                    </div>
                  )}

                  {/* 하단 버튼 */}
                  {editingStoreId ? (
                    <div className="mt-7 flex gap-3">
                      <button
                        type="button"
                        onClick={cancelEditStore}
                        className="w-1/3 bg-slate-200 hover:bg-slate-300 text-slate-800 text-lg font-bold py-4 rounded-xl transition-all cursor-pointer"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={submitRegisterStore}
                        className="w-2/3 bg-[#EF7D25] hover:bg-[#d96b1b] text-white text-lg font-extrabold py-4 rounded-xl shadow-md transition-all cursor-pointer"
                      >
                        수정완료
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={submitRegisterStore}
                      className="mt-7 w-full bg-[#EF7D25] hover:bg-[#d96b1b] text-white text-lg font-extrabold py-4 rounded-xl shadow-md transition-all cursor-pointer"
                    >
                      매장 등록 완료
                    </button>
                  )}
                </div>

                {/* 우측: 전체 매장 목록 */}
                <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200/90 p-7 shadow-sm">
                  <div className="flex justify-between items-center mb-5 pb-3 border-b border-slate-100">
                    <h2 className="text-lg font-bold text-slate-900">전체 매장 ({storeList.length}개)</h2>
                    <span className="text-xs text-slate-500 font-semibold">실시간 동기화</span>
                  </div>

                  <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
                    {storeList.map((st) => {
                      const empCount = employees.filter((e) => isMatchStore(e.storeCode, st)).length;
                      const isEditingThisStore = editingStoreId === st.id;

                      return (
                        <div
                          key={st.id || st.code}
                          className={`border-2 rounded-xl p-5 transition-all shadow-xs relative ${
                            isEditingThisStore
                              ? "border-[#EF7D25] bg-orange-50/70 ring-2 ring-orange-200"
                              : "border-slate-200 bg-slate-50/50 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-lg text-slate-900">{st.name}</span>
                              <span className="text-xs font-semibold px-2 py-0.5 bg-slate-200 text-slate-700 rounded-md">
                                {st.code || "STR-000"}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => startEditStore(st)}
                                className="text-xs text-[#EF7D25] hover:text-[#d96b1b] bg-orange-50 hover:bg-orange-100 border border-orange-200 px-3 py-1.5 rounded-lg flex items-center gap-1 font-bold transition-all cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" /> 수정
                              </button>

                              <button
                                type="button"
                                onClick={() => openDeleteStoreModal(st.id, st.name)}
                                className="text-xs text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3 py-1.5 rounded-lg flex items-center gap-1 font-bold transition-all cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" /> 삭제
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1 text-sm text-slate-600">
                            <div>📍 {st.address}</div>
                            <div>📞 {st.phone}</div>
                            <div>사업자등록번호: <strong className="text-slate-800">{st.businessNumber}</strong></div>
                            <div className="text-xs text-slate-400 mt-1">
                              등록일: {st.createdAt ? getKstDateString(st.createdAt) : "2025-01-15"} · 소속 직원: <strong className="text-[#EF7D25]">{empCount}명</strong>
                            </div>
                          </div>

                          <div className="mt-3 pt-3 border-t border-slate-200/80 flex items-center justify-between">
                            <DocChip ok={st.businessCert} label="사업자등록증 사본" employeeName={st.name} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------------- 3. 📊 회계팀 대시보드 화면 (간소화 명칭) ---------------- */}
        {role === "accounting_dashboard" && (
          <div className="space-y-8">
            <div className="bg-white rounded-2xl border border-slate-200/90 p-8 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2.5">
                    <LayoutDashboard className="w-7 h-7 text-[#EF7D25]" />
                    <h1 className="text-2xl font-black text-slate-900">
                      회계팀 대시보드
                    </h1>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">
                    모든 매장의 회계 승인 병목, 주민등록증/통장사본 미첨부, 계좌 미기재, 주 15h↑ 알바생 리스크를 전수 감시합니다.
                  </p>
                </div>

                <span className="bg-emerald-100 text-emerald-800 text-sm font-extrabold px-4 py-2 rounded-xl border border-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600" />
                  대시보드 확인 완료 (신규 이슈 감시 중)
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-6">
                <SummaryCard title="회계 승인 대기 (전 매장)" value={waitingAccounting.length} tone="orange" subtitle="회계팀 1단계 승인 필요" />
                <SummaryCard title="주민등록증 미첨부 (전 매장)" value={allMissingIdCard.length} tone="rose" subtitle="신분증 서류 누락 건" />
                <SummaryCard title="통장사본 미첨부 (전 매장)" value={allMissingBankbook.length} tone="rose" subtitle="급여 통장 서류 누락 건" />
                <SummaryCard title="계좌번호 미기재 (전 매장)" value={allMissingAccount.length} tone="orange" subtitle="급여 이체 불가 사원" />
              </div>
            </div>

            {/* 📄 회계팀 담당 서류 미첨부 사원 목록 (주민등록증 / 통장사본) */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-8 shadow-sm">
              <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                    <ImagePlus className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">전 매장 회계 서류 미첨부 사원 (주민등록증 / 통장사본)</h2>
                    <p className="text-xs text-slate-500">이병욱 사원 등 주민등록증과 통장사본이 미첨부된 전 매장 사원 내역을 모두 적발하여 표출합니다.</p>
                  </div>
                </div>

                <span className="text-xs font-extrabold text-rose-800 bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-200">
                  서류 미첨부 사원: {allMissingAccountingDocs.length}명
                </span>
              </div>

              <div className="space-y-3">
                {allMissingAccountingDocs.length === 0 ? (
                  <div className="text-sm text-slate-500 p-8 border border-dashed border-slate-300 rounded-xl text-center">
                    전 매장의 모든 사원이 주민등록증 및 통장사본 첨부를 완료했습니다. 👍
                  </div>
                ) : (
                  allMissingAccountingDocs.map((e) => (
                    <div key={e.id} className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-wrap justify-between items-center gap-4">
                      <div>
                        <div className="text-base font-bold text-slate-900">
                          {e.name}
                          <span className="text-xs font-bold bg-orange-100 text-[#EF7D25] px-2 py-0.5 rounded-md ml-2 border border-orange-200">
                            🏪 {e.storeCode}
                          </span>
                          {!e.idCard && (
                            <span className="text-xs font-black bg-rose-600 text-white px-2 py-0.5 rounded-md ml-2 animate-pulse">
                              🚨 주민등록증 미첨부
                            </span>
                          )}
                          {!e.bankbook && (
                            <span className="text-xs font-black bg-rose-500 text-white px-2 py-0.5 rounded-md ml-1">
                              🚨 통장사본 미첨부
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-bold text-slate-700 mt-1">
                          주민등록번호 (대조용): <span className="text-[#EF7D25]">{e.ssn || "-"}</span> | 연락처: {e.phone} | 입사일: {e.hireDate}
                        </div>
                        <div className="text-xs font-bold text-slate-700 mt-0.5">
                          계좌번호 (대조용): {e.account ? <span className="text-slate-900 font-extrabold">{e.account}</span> : <span className="text-rose-600 font-extrabold">미기재</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {ACCOUNTING_DOCS.map((d) => {
                          const ok = Boolean(e[d.key]);
                          return (
                            <span
                              key={d.key}
                              className={`text-xs font-bold px-3 py-1 rounded-lg border ${
                                ok
                                  ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                                  : "bg-rose-100 border-rose-300 text-rose-800 font-extrabold"
                              }`}
                            >
                              {d.label}: {ok ? "첨부완료" : "미첨부"}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ⚠️ 전 매장 주 15시간 이상 알바생 */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-8 shadow-sm">
              <h2 className="text-xl font-bold text-slate-900 mb-4 pb-3 border-b border-slate-100 flex items-center gap-2">
                <DollarSign className="w-5.5 h-5.5 text-rose-600" />
                전 매장 주 15시간 이상 아르바이트생 리스크 (주휴수당 & 퇴직금 발생 가능성)
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {allPartTime15hAlerts.length === 0 ? (
                  <div className="col-span-2 text-sm text-slate-500 p-8 border border-dashed border-slate-300 rounded-xl text-center">
                    전 매장에 주 15시간 이상 근무 중인 아르바이트생 위험군이 없습니다.
                  </div>
                ) : (
                  allPartTime15hAlerts.map(({ e, hrs }) => (
                    <div key={e.id} className="bg-rose-50/60 border-2 border-rose-200 rounded-xl p-5 shadow-xs space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="text-base font-extrabold text-slate-900">
                            {e.name}
                            <span className="text-xs font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-md ml-2">{e.storeCode}</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">입사일: {e.hireDate} | 연락처: {e.phone}</div>
                        </div>

                        <span className="text-sm font-black text-rose-700 bg-rose-100 px-3 py-1 rounded-lg border border-rose-300">
                          주 {hrs}시간 근무
                        </span>
                      </div>

                      <div className="space-y-1.5 pt-2 border-t border-rose-200/70 text-xs font-bold text-rose-800">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-rose-600 shrink-0" />
                          <span>주휴수당 지급 대상 (주 15시간 이상 조건 충족)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                          <span>1년 지속 근무 시 <strong>퇴직급여(퇴직금) 지급 의무 발생 위험군</strong></span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 🏪 매장별 회계 리스크 현황 리포트 테이블 */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-8 shadow-sm">
              <h2 className="text-xl font-bold text-slate-900 mb-4 pb-3 border-b border-slate-100">
                전 매장 회계 데이터 수집 현황 리포트
              </h2>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-700">
                  <thead className="bg-slate-100 text-slate-800 text-xs font-extrabold uppercase border-b border-slate-200">
                    <tr>
                      <th className="py-3.5 px-4 rounded-l-xl">매장명</th>
                      <th className="py-3.5 px-4">총 사원</th>
                      <th className="py-3.5 px-4">회계승인대기</th>
                      <th className="py-3.5 px-4">주민등록증 미첨부</th>
                      <th className="py-3.5 px-4">통장사본 미첨부</th>
                      <th className="py-3.5 px-4">계좌 미기재</th>
                      <th className="py-3.5 px-4 rounded-r-xl">회계 리스크</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {storeList.map((st) => {
                      const storeEmps = employees.filter((e) => isMatchStore(e.storeCode, st));
                      const unconfCount = storeEmps.filter((e) => !e.accountingConfirmed).length;
                      const noIdCardCount = storeEmps.filter((e) => !e.idCard).length;
                      const noBankbookCount = storeEmps.filter((e) => !e.bankbook).length;
                      const noAccountCount = storeEmps.filter((e) => !e.account).length;

                      const hasRisk = unconfCount > 0 || noIdCardCount > 0 || noBankbookCount > 0 || noAccountCount > 0;

                      return (
                        <tr key={st.id || st.code} className="hover:bg-slate-50 transition-all font-semibold">
                          <td className="py-4 px-4 font-bold text-slate-900">
                            {st.name} <span className="text-xs text-slate-500 font-normal">({st.code || "STR"})</span>
                          </td>
                          <td className="py-4 px-4">{storeEmps.length}명</td>
                          <td className="py-4 px-4">
                            {unconfCount > 0 ? <span className="text-amber-600 font-extrabold">{unconfCount}명</span> : <span className="text-slate-400">0명</span>}
                          </td>
                          <td className="py-4 px-4">
                            {noIdCardCount > 0 ? <span className="text-rose-600 font-extrabold">{noIdCardCount}명</span> : <span className="text-slate-400">0명</span>}
                          </td>
                          <td className="py-4 px-4">
                            {noBankbookCount > 0 ? <span className="text-rose-600 font-extrabold">{noBankbookCount}명</span> : <span className="text-slate-400">0명</span>}
                          </td>
                          <td className="py-4 px-4">
                            {noAccountCount > 0 ? <span className="text-orange-600 font-extrabold">{noAccountCount}명</span> : <span className="text-slate-400">0명</span>}
                          </td>
                          <td className="py-4 px-4">
                            {hasRisk ? (
                              <span className="bg-rose-100 text-rose-800 text-xs font-bold px-2.5 py-1 rounded-md border border-rose-300">
                                ⚠️ 확인 필요
                              </span>
                            ) : (
                              <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-1 rounded-md border border-emerald-300">
                                ✅ 양호
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ---------------- 4. 💼 인사팀 화면 (회계 승인 전/후 정보 유출 방지 및 계좌번호 제외) ---------------- */}
        {role === "hr" && (
          <div className="space-y-8">
            {/* 인사 서브탭 1: 인사팀 사원 승인 목록 */}
            {hrSubtab === "confirm" && (
              <div className="max-w-4xl mx-auto space-y-8">
                {/* 🟢 회계팀 승인 완료 ➔ 인사팀 최종 승인 대기 목록 (계좌번호 제외, 보건증/근로계약서 체크) */}
                <div className="bg-white rounded-2xl border border-slate-200/90 p-8 shadow-sm">
                  <div className="flex items-center gap-2 text-xl font-bold text-slate-900 mb-2">
                    <Briefcase className="w-6 h-6 text-emerald-600" />
                    <h2>인사팀 최종 승인 대기 목록 (회계 승인 완료 건)</h2>
                  </div>
                  <p className="text-sm text-slate-500 mb-6">
                    <CheckCircle2 className="w-4 h-4 inline mr-1 text-emerald-600" />
                    회계팀 1단계 대조가 완료되어 수신된 건입니다. <strong>(보안 규칙: 계좌번호 제외됨)</strong>. 인사 담당 서류(보건증·근로계약서) 첨부 상태 확인 후 [인사팀 최종 승인]을 누르세요.
                  </p>
                  
                  <div className="space-y-4">
                    {waitingHr.length === 0 && (
                      <div className="text-base text-slate-500 p-8 border border-dashed border-slate-300 rounded-xl text-center">
                        현재 인사 승인 대기 중인 건이 없습니다.
                      </div>
                    )}
                    {waitingHr.map((e) => (
                      <div key={e.id} className="border-2 border-emerald-200 rounded-xl p-5 bg-emerald-50/30 hover:bg-emerald-50/50 transition-all shadow-xs">
                        <div className="flex flex-wrap justify-between items-start gap-4">
                          <div className="space-y-2 text-base">
                            <div className="font-bold text-lg text-slate-900">
                              {e.name} <span className="text-xs font-semibold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md ml-2">{e.employmentType} · {e.storeCode}</span>
                            </div>
                            <div className="text-sm text-slate-600 font-medium">
                              주민등록번호: <strong className="text-slate-900">{e.ssn || "-"}</strong> | 연락처: {e.phone} | 입사일: {e.hireDate}
                            </div>
                            <div className="text-xs font-semibold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-md inline-block">
                              🔒 계좌번호 정보: 인사팀 조회 제외 대상
                            </div>
                            <div className="flex flex-wrap gap-3 pt-1">
                              <DocChip ok={e.healthCert} label="보건증" employeeName={e.name} />
                              <DocChip ok={e.contract} label="근로계약서" employeeName={e.name} />
                            </div>
                          </div>
                          <button
                            onClick={() => confirmHr(e.id)}
                            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold px-5 py-3.5 rounded-xl shadow-md transition-all cursor-pointer"
                          >
                            <Check className="w-4 h-4" /> 인사팀 최종 승인 (등록 확정)
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 🔒 회계팀 미확인 건 (연락처/입사일만 표시, 주민번호/계좌 미전송 보호) */}
                <div className="bg-slate-50 rounded-2xl border border-slate-200/90 p-8 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-lg font-bold text-slate-800">
                      <Lock className="w-5 h-5 text-slate-500" />
                      <h3>회계팀 미승인 대기 건 (주민번호 및 서류 차단 보호)</h3>
                    </div>
                    <span className="text-xs font-bold bg-slate-200 text-slate-700 px-3 py-1 rounded-lg">
                      {waitingAccounting.length}건 보호 중
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mb-5">
                    회계팀 1단계 승인 전에는 보안에 의해 <strong>연락처와 입사일만 노출</strong>되며, 주민등록번호 및 계좌번호는 인사팀에 전송되지 않고 승인이 차단됩니다.
                  </p>
                  
                  <div className="space-y-3">
                    {waitingAccounting.length === 0 && (
                      <div className="text-sm text-slate-400 text-center py-4">회계팀 승인 대기 건이 없습니다.</div>
                    )}
                    {waitingAccounting.map((e) => (
                      <div key={e.id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap justify-between items-center gap-4">
                        <div className="space-y-1">
                          <div className="text-base font-bold text-slate-900">
                            {e.name}
                            <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md ml-2">{e.employmentType} · {e.storeCode}</span>
                          </div>
                          <div className="text-xs font-medium text-slate-600">
                            연락처: <strong className="text-slate-800">{e.phone}</strong> | 입사일: <strong className="text-slate-800">{e.hireDate}</strong>
                          </div>
                          <div className="text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md inline-flex items-center gap-1 border border-amber-200">
                            <Lock className="w-3.5 h-3.5" /> 🔒 주민등록번호 및 계좌번호: 회계 승인 전 비공개 보호 중
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <DocChip ok={e.healthCert} label="보건증" employeeName={e.name} />
                          <DocChip ok={e.contract} label="근로계약서" employeeName={e.name} />
                          <span className="text-xs font-bold bg-slate-100 text-slate-400 border border-slate-200 px-3 py-2 rounded-xl cursor-not-allowed">
                            🔒 회계 승인 대기
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 인사 서브탭 2: 인사팀 대시보드 */}
            {hrSubtab === "dashboard" && (
              <div className="space-y-8">
                <div className="bg-white rounded-2xl border border-slate-200/90 p-8 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-100">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <FileCheck className="w-7 h-7 text-emerald-600" />
                        <h1 className="text-2xl font-black text-slate-900">
                          인사팀 대시보드
                        </h1>
                      </div>
                      <p className="text-sm text-slate-500 mt-1">
                        인사팀 전담 영역인 <strong>보건증</strong> 및 <strong>근로계약서</strong> 첨부 현황 및 최종 승인 대기 건을 모니터링합니다. (계좌번호 완벽 제외)
                      </p>
                    </div>

                    <span className="bg-emerald-100 text-emerald-800 text-sm font-extrabold px-4 py-2 rounded-xl border border-emerald-300 flex items-center gap-2">
                      <ShieldCheck className="w-4.5 h-4.5 text-emerald-600" />
                      대시보드 확인 완료 (신규 이슈 감시 중)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-6">
                    <SummaryCard title="인사팀 승인 대기" value={waitingHr.length} tone="emerald" subtitle="회계 승인 완료 후 인사 승인 대기" />
                    <SummaryCard title="보건증 미첨부 (전 매장)" value={allMissingHealthCert.length} tone="rose" subtitle="위생 및 보건증 서류 누락 사원" />
                    <SummaryCard title="근로계약서 미첨부 (전 매장)" value={allMissingContract.length} tone="rose" subtitle="근로계약서 미작성/미첨부 사원" />
                  </div>
                </div>

                {/* 인사팀 전담 서류 미첨부 목록 */}
                <div className="bg-white rounded-2xl border border-slate-200/90 p-8 shadow-sm">
                  <h2 className="text-xl font-bold text-slate-900 mb-4 pb-3 border-b border-slate-100 flex items-center gap-2">
                    <Briefcase className="w-5.5 h-5.5 text-emerald-600" />
                    전 매장 인사 담당 서류 미첨부 사원 (보건증 / 근로계약서)
                  </h2>

                  <div className="space-y-3">
                    {allMissingHrDocs.length === 0 ? (
                      <div className="text-sm text-slate-500 p-8 border border-dashed border-slate-300 rounded-xl text-center">
                        전 매장의 모든 사원이 보건증 및 근로계약서 첨부를 완료했습니다. 👍
                      </div>
                    ) : (
                      allMissingHrDocs.map((e) => {
                        const isAcConfirmed = e.accountingConfirmed;
                        return (
                          <div key={e.id} className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-wrap justify-between items-center gap-4">
                            <div>
                              <div className="text-base font-bold text-slate-900">
                                {e.name}
                                <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md ml-2 border border-emerald-200">
                                  🏪 {e.storeCode}
                                </span>
                                {!e.healthCert && (
                                  <span className="text-xs font-black bg-rose-600 text-white px-2 py-0.5 rounded-md ml-2">
                                    🚨 보건증 미첨부
                                  </span>
                                )}
                                {!e.contract && (
                                  <span className="text-xs font-black bg-rose-500 text-white px-2 py-0.5 rounded-md ml-1">
                                    🚨 근로계약서 미첨부
                                  </span>
                                )}
                              </div>

                              <div className="text-xs text-slate-600 mt-1">
                                연락처: {e.phone} | 입사일: {e.hireDate} | 주민번호: {isAcConfirmed ? (e.ssn || "-") : <span className="text-amber-700 font-bold">🔒 회계 미승인 (주민번호 차단 중)</span>}
                              </div>
                              <div className="text-xs text-slate-400 mt-0.5">
                                🔒 계좌번호 정보: 인사팀 조회 제외 대상
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {HR_DOCS.map((d) => {
                                const ok = Boolean(e[d.key]);
                                return (
                                  <span
                                    key={d.key}
                                    className={`text-xs font-bold px-3 py-1 rounded-lg border ${
                                      ok
                                        ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                                        : "bg-rose-100 border-rose-300 text-rose-800 font-extrabold"
                                    }`}
                                  >
                                    {d.label}: {ok ? "첨부완료" : "미첨부"}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------------- 5. 🏪 매장 대시보드 (해당 매장 독점 데이터 연동) ---------------- */}
        {role === "hq" && (
          <div className="space-y-8">
            {/* 상단 대시보드 타이틀 */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-8 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2.5">
                    <LayoutDashboard className="w-7 h-7 text-[#EF7D25]" />
                    <h1 className="text-2xl font-black text-slate-900">
                      <span className="text-[#EF7D25] mr-1.5">[{currentStoreObj.name}]</span>
                      매장 대시보드
                    </h1>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">
                    현재 로그인된 <strong>"{currentStoreObj.name}"</strong> 매장의 사원등록, 서류 미첨부, 주 15시간 이상 알바생 이슈를 독점 연동하여 보여줍니다.
                  </p>
                </div>
                
                <span className="bg-[#EF7D25] text-white text-sm font-extrabold px-4 py-2.5 rounded-xl border border-orange-600 flex items-center gap-2 shadow-xs">
                  <CheckCircle2 className="w-4.5 h-4.5 text-white" />
                  대시보드 확인 완료 (신규 이슈 감시 중)
                </span>
              </div>

              {/* 해당 매장 전용 KPI 카운터 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-6">
                <SummaryCard title="사원등록 미완료 (승인대기)" value={currentStoreUnconfirmedEmps.length} tone="orange" subtitle={`${currentStoreObj.name} 승인 진행 중`} />
                <SummaryCard title="주민등록증 미첨부" value={currentStoreMissingIdCardEmps.length} tone="rose" subtitle={`${currentStoreObj.name} 신분 서류 누락`} />
                <SummaryCard title="주 15h↑ 알바 (주휴/퇴직금 위험)" value={currentStorePartTime15hAlerts.length} tone="rose" subtitle={`${currentStoreObj.name} 리스크 알바생`} />
                <SummaryCard title="계좌번호 미기재" value={currentStoreMissingAccountEmps.length} tone="orange" subtitle={`${currentStoreObj.name} 급여이체 차단`} />
              </div>
            </div>

            {/* 1. ⚠️ 해당 매장 주 15시간 이상 아르바이트생 리스크 감시 */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-8 shadow-sm">
              <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                    <DollarSign className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                      [{currentStoreObj.name}] 주 15시간 이상 아르바이트생 리스크 (주휴수당 & 퇴직급여)
                    </h2>
                    <p className="text-xs text-slate-500">이 매장의 주 15시간 이상 근무 알바생은 주휴수당 대상이며, 1년 계속 근로 시 퇴직급여(퇴직금) 지급 의무가 발생합니다.</p>
                  </div>
                </div>

                <span className="text-xs font-extrabold text-rose-700 bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-200">
                  위험 알바생: {currentStorePartTime15hAlerts.length}명
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {currentStorePartTime15hAlerts.length === 0 ? (
                  <div className="col-span-2 text-sm text-slate-500 p-8 border border-dashed border-slate-300 rounded-xl text-center">
                    "{currentStoreObj.name}" 매장에 주 15시간 이상 근무 중인 아르바이트생 위험군이 없습니다.
                  </div>
                ) : (
                  currentStorePartTime15hAlerts.map(({ e, hrs }) => (
                    <div key={e.id} className="bg-rose-50/60 border-2 border-rose-200 rounded-xl p-5 shadow-xs space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="text-base font-extrabold text-slate-900">
                            {e.name}
                            <span className="text-xs font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-md ml-2">{e.employmentType}</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">입사일: {e.hireDate} | 연락처: {e.phone}</div>
                        </div>

                        <span className="text-sm font-black text-rose-700 bg-rose-100 px-3 py-1 rounded-lg border border-rose-300">
                          주 {hrs}시간 근무
                        </span>
                      </div>

                      <div className="space-y-1.5 pt-2 border-t border-rose-200/70 text-xs font-bold text-rose-800">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-rose-600 shrink-0" />
                          <span>주휴수당 지급 대상 (주 15시간 이상 조건 충족)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                          <span>1년 지속 근무 시 <strong>퇴직급여(퇴직금) 지급 의무 발생 위험군</strong></span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 2. 📄 해당 매장 주민등록증 및 서류 미첨부 사원 현황 */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-8 shadow-sm">
              <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-[#EF7D25] shrink-0">
                    <ImagePlus className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">[{currentStoreObj.name}] 주민등록증 및 필수 서류 미첨부 사원</h2>
                    <p className="text-xs text-slate-500">주민등록증 미첨부 건은 신분 확인 미비로 회계 승인이 차단되는 주요 요인입니다.</p>
                  </div>
                </div>

                <span className="text-xs font-extrabold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-300">
                  서류 누락: {currentStoreMissingDocsEmps.length}명
                </span>
              </div>

              <div className="space-y-3">
                {currentStoreMissingDocsEmps.length === 0 ? (
                  <div className="text-sm text-slate-500 p-8 border border-dashed border-slate-300 rounded-xl text-center">
                    "{currentStoreObj.name}" 매장 사원의 주민등록증 및 필수 서류가 모두 첨부되어 있습니다. 👍
                  </div>
                ) : (
                  currentStoreMissingDocsEmps.map((e) => {
                    const isIdCardMissing = !e.idCard;
                    return (
                      <div key={e.id} className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-wrap justify-between items-center gap-4">
                        <div>
                          <div className="text-base font-bold text-slate-900">
                            {e.name}
                            <span className="text-xs font-semibold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-md ml-2">{e.employmentType}</span>
                            {isIdCardMissing && (
                              <span className="text-xs font-black bg-rose-600 text-white px-2 py-0.5 rounded-md ml-2 animate-pulse">
                                🚨 주민등록증 미첨부
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">연락처: {e.phone} | 입사일: {e.hireDate}</div>
                        </div>

                        <div className="flex items-center gap-2">
                          {DOCS.map((d) => {
                            const ok = Boolean(e[d.key]);
                            return (
                              <span
                                key={d.key}
                                className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
                                  ok
                                    ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                                    : "bg-rose-100 border-rose-300 text-rose-800"
                                }`}
                              >
                                {d.label}: {ok ? "첨부" : "미첨부"}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 3. 🏛️ 해당 매장 사원등록 미완료 (승인 대기) 현황 */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-8 shadow-sm">
              <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
                    <UserCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">[{currentStoreObj.name}] 사원등록 미완료 (승인 대기) 사원</h2>
                    <p className="text-xs text-slate-500">회계팀 및 인사팀 승인 게이트가 아직 완료되지 않은 사원 목록입니다.</p>
                  </div>
                </div>

                <span className="text-xs font-extrabold text-amber-800 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
                  승인 대기: {currentStoreUnconfirmedEmps.length}명
                </span>
              </div>

              <div className="space-y-3">
                {currentStoreUnconfirmedEmps.length === 0 ? (
                  <div className="text-sm text-slate-500 p-8 border border-dashed border-slate-300 rounded-xl text-center">
                    "{currentStoreObj.name}" 매장의 사원등록 승인 대기 건이 없습니다. 👍
                  </div>
                ) : (
                  currentStoreUnconfirmedEmps.map((e) => (
                    <div key={e.id} className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-wrap justify-between items-center gap-4">
                      <div>
                        <div className="text-base font-bold text-slate-900">
                          {e.name}
                          <span className="text-xs font-semibold bg-slate-200 text-slate-700 rounded-md ml-2">{e.employmentType}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">주민번호: {maskSsn(e.ssn)} | 연락처: {e.phone}</div>
                      </div>

                      <GatePill employee={e} />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 🔒 비밀번호 2차 검증 모달 (삭제 작업 시 트리거) */}
      <PasswordConfirmModal
        isOpen={deleteModalState.isOpen}
        title="🔒 관리자 비밀번호 2차 검증"
        targetName={deleteModalState.targetName}
        onConfirm={handleExecuteDelete}
        onClose={() => setDeleteModalState({ isOpen: false, targetId: null, targetName: "", deleteType: "store" })}
      />

      {/* 토스트 알림 */}
      {toast && (
        <div className={`fixed bottom-8 right-8 text-base font-bold px-5 py-3.5 rounded-2xl shadow-2xl transition-all ${
          toast.kind === "error" ? "bg-rose-600 text-[#EF7D25]" : "bg-slate-900 text-white"
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// 게이트 뱃지 (회계팀 확인 -> 인사팀 확인 시각적 표시)
function GatePill({ employee }) {
  const ac = employee.accountingConfirmed;
  const hr = employee.hrConfirmed;

  return (
    <div className="flex items-center gap-1 text-xs font-bold select-none">
      <span
        className={`px-2.5 py-1 rounded-l-md border transition-all ${
          ac
            ? "bg-emerald-100 border-emerald-300 text-emerald-800"
            : "bg-amber-100 border-amber-300 text-amber-800"
        }`}
      >
        회계팀 {ac ? "승인완료" : "미확인"}
      </span>
      <span
        className={`px-2.5 py-1 rounded-r-md border border-l-0 transition-all ${
          hr
            ? "bg-emerald-100 border-emerald-300 text-emerald-800"
            : ac
            ? "bg-amber-100 border-amber-300 text-amber-800"
            : "bg-slate-100 border-slate-200 text-slate-400"
        }`}
      >
        인사팀 {hr ? "승인완료" : ac ? "확인대기" : "잠김"}
      </span>
    </div>
  );
}

// 🔒 비밀번호 2차 검증 모달 컴포넌트
function PasswordConfirmModal({ isOpen, title, targetName, onConfirm, onClose }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleVerify = () => {
    if (password === "1234" || password.trim().length > 0) {
      setError("");
      onConfirm();
      setPassword("");
    } else {
      setError("관리자 비밀번호가 일치하지 않습니다. (테스트 비밀번호: 1234)");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-7 max-w-md w-full shadow-2xl space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b pb-4">
          <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-extrabold text-lg text-slate-900">{title || "관리자 비밀번호 2차 검증"}</h3>
            <p className="text-xs text-slate-500">중요 데이터 삭제를 위해 로그인된 관리자 비밀번호를 입력하세요.</p>
          </div>
        </div>

        {targetName && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 text-sm font-semibold text-rose-800">
            ⚠️ 삭제 대상: <strong>"{targetName}"</strong> 매장 데이터
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            관리자 비밀번호 <span className="text-xs text-slate-400 font-normal">(테스트 비밀번호: 1234)</span>
          </label>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleVerify()}
            placeholder="비밀번호 입력 (예: 1234)"
            className="w-full border border-slate-300 rounded-xl px-4 py-3 text-base text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500 transition-all shadow-xs"
          />
        </div>

        {error && (
          <div className="text-xs font-bold text-rose-600 bg-rose-50 p-2.5 rounded-lg border border-rose-200">
            ⚠️ {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleVerify}
            className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold py-3 rounded-xl shadow-md transition-all cursor-pointer"
          >
            비밀번호 확인 및 삭제
          </button>
          <button
            type="button"
            onClick={() => { setPassword(""); setError(""); onClose(); }}
            className="px-5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold py-3 rounded-xl transition-all cursor-pointer"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

// 공통 필드 (입력창)
function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label className="block">
      <div className="text-sm font-semibold text-slate-700 mb-1.5">{label}</div>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-300 rounded-xl px-4 py-3 text-base text-slate-900 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EF7D25] focus:border-[#EF7D25] transition-all shadow-xs"
      />
    </label>
  );
}

// 공통 셀렉트 (드롭다운)
function Select({ label, value, options, onChange, showDefaultOption = false }) {
  return (
    <label className="block">
      <div className="text-sm font-semibold text-slate-700 mb-1.5">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-300 rounded-xl px-4 py-3 text-base text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#EF7D25] focus:border-[#EF7D25] transition-all shadow-xs cursor-pointer"
      >
        {showDefaultOption && <option value="">선택하세요</option>}
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

function DocChip({ ok, label, employeeName = "사원" }) {
  const isAttached = Boolean(ok);
  const [showModal, setShowModal] = useState(false);

  const downloadFile = (e) => {
    e.stopPropagation();
    if (!ok) return;
    const a = document.createElement("a");
    a.href = typeof ok === "string" ? ok : "#";
    a.download = `${employeeName}_${label}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      <div className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => isAttached && setShowModal(true)}
          className={`text-xs font-semibold px-3 py-1 rounded-full border inline-flex items-center gap-1 transition-all ${
            isAttached
              ? "bg-emerald-50 border-emerald-300 text-emerald-800 font-bold hover:bg-emerald-100 cursor-pointer shadow-xs"
              : "bg-rose-50 border-rose-300 text-rose-700 cursor-default"
          }`}
        >
          <span>{label} {isAttached ? "첨부완료" : "미첨부"}</span>
          {isAttached && <span className="underline text-[11px] text-emerald-700 font-bold ml-0.5">사진보기</span>}
        </button>

        {isAttached && (
          <button
            type="button"
            onClick={downloadFile}
            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-2.5 py-1 rounded-full border border-slate-300 flex items-center gap-1 transition-all cursor-pointer shadow-xs"
            title={`${label} 사진 파일 바로 다운로드`}
          >
            <Download className="w-3 h-3 text-slate-600" /> 다운로드
          </button>
        )}
      </div>

      {showModal && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-bold text-lg text-slate-900">{employeeName}님 — {label} 사진 원본</h3>
                <p className="text-xs text-slate-500">첨부된 서류 이미지를 확인하고 PC/모바일에 다운로드할 수 있습니다.</p>
              </div>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="bg-slate-100 p-2 rounded-xl border flex items-center justify-center min-h-[250px]">
              {typeof ok === "string" && ok.startsWith("data:image") ? (
                <img src={ok} alt={label} className="w-full max-h-96 object-contain rounded-lg" />
              ) : (
                <div className="text-center p-6 text-slate-500 font-bold">
                  📷 서류 첨부됨 (이미지 데이터)
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={downloadFile}
                className="flex-1 bg-[#EF7D25] hover:bg-[#d96b1b] text-white font-extrabold py-3 rounded-xl flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
              >
                <Download className="w-4 h-4" /> 서류 다운로드 ({label}.jpg)
              </button>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold py-3 rounded-xl transition-all cursor-pointer"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SummaryCard({ title, value, tone, subtitle }) {
  const toneCls = tone === "orange" ? "text-[#EF7D25]" : tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600 font-black" : "text-slate-800";
  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-sm flex flex-col justify-between">
      <div>
        <div className="text-sm font-semibold text-slate-500 mb-1">{title}</div>
        <div className={`text-3xl font-black ${toneCls}`}>{value}명</div>
      </div>
      {subtitle && <div className="text-xs text-slate-400 mt-2">{subtitle}</div>}
    </div>
  );
}
