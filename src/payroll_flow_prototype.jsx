import React, { useState, useMemo, useEffect } from "react";
import {
  Store, Landmark, Briefcase, Building2, UserPlus, Lock, Unlock,
  CheckCircle2, Circle, AlertTriangle, Clock, ImagePlus, Check, X, Users, RefreshCw, Download, ArrowRight, ShieldAlert, Edit3, Trash2, Key, UserCheck, PlusCircle, ShieldCheck, MapPin, Phone, FileText, LayoutDashboard, DollarSign, AlertCircle, FileCheck, Calendar, ArrowRightCircle, Trash, Save, Sliders, HelpCircle, ChevronRight
} from "lucide-react";
import * as firebaseService from "../firebaseService";

const EMPLOYMENT_TYPES = ["정직원", "아르바이트", "일용직"];
const ATTEND_TYPES = ["정상출근", "휴무", "결근", "연차", "반차", "지각", "조퇴", "출장(외근)"];

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

const DEFAULT_LABOR_CONFIG = {
  weeklyAllowance: {
    targetHours: 15,
    level1Min: 10.0,
    level1Max: 11.9,
    level2Min: 12.0,
    level2Max: 13.4,
    level3Min: 13.5,
    level3Max: 14.9,
    confirmedMin: 15.0,
  },
  socialInsurance: {
    targetHours: 60,
    targetDays: 8,
    targetIncome: 220,
    level1HoursMin: 40,
    level1HoursMax: 49,
    level1DaysMin: 4,
    level1DaysMax: 5,
    level2HoursMin: 50,
    level2HoursMax: 54,
    level2DaysMin: 6,
    level2DaysMax: 6,
    level3HoursMin: 55,
    level3HoursMax: 59,
    level3DaysMin: 7,
    level3DaysMax: 7,
    confirmedHoursMin: 60,
    confirmedDaysMin: 8,
    confirmedIncomeMin: 220,
  },
  severance: {
    targetMonths: 12,
    level1Months: 6,
    level2Months: 8,
    level3Months: 10,
    confirmedMonths: 12,
  },
};

function getElapsedMonths(hireDateStr) {
  if (!hireDateStr) return 0;
  const hire = new Date(hireDateStr);
  if (isNaN(hire.getTime())) return 0;
  const now = new Date();
  let months = (now.getFullYear() - hire.getFullYear()) * 12 + (now.getMonth() - hire.getMonth());
  if (now.getDate() < hire.getDate()) {
    months -= 1;
  }
  return Math.max(0, months);
}

function evaluateEmployeeLaborConditions(emp, attendanceList, config = DEFAULT_LABOR_CONFIG, currentDateStr = "2025-02-13") {
  if (!emp || emp.employmentType !== "아르바이트") {
    return { weeklyBadge: null, insuranceBadge: null, severanceBadge: null, badges: [], highestLevelNum: 0 };
  }

  const activeCfg = config || DEFAULT_LABOR_CONFIG;

  // 1. 주휴수당 (weeklyAllowance) - 정직원 제외
  let weeklyBadge = null;
  if (emp.employmentType !== "정직원") {
    const empAtt = attendanceList ? attendanceList.filter((a) => a.employeeId === emp.id && a.type === "정상출근") : [];
    const weeklyHours = empAtt.reduce((sum, a) => sum + (a.totalHours || a.hours || 0), 0);
    
    // 요일 경과에 따른 시뮬레이션 근로시간 (월요일=1, 일요일=7) -> 월요일에 리셋
    const currDate = new Date(currentDateStr);
    let dayOfWeek = currDate.getDay();
    if (dayOfWeek === 0) dayOfWeek = 7; 
    
    const idNum = parseInt(String(emp.id).replace(/\D/g, "") || "1", 10);
    // 1주일에 12 ~ 20시간을 배정받는다고 가정
    const maxWeeklyHours = (((idNum * 4.3) % 9) + 12); 
    const simWeeklyHours = weeklyHours > 0 ? weeklyHours : Math.round((maxWeeklyHours / 7) * dayOfWeek * 10) / 10;
    
    const curHrs = simWeeklyHours;
    const cfg = activeCfg.weeklyAllowance || DEFAULT_LABOR_CONFIG.weeklyAllowance;

    if (curHrs >= cfg.confirmedMin) {
      weeklyBadge = {
        category: "주휴수당",
        level: "confirmed",
        levelNum: 4,
        text: "주휴수당 발생 확정",
        color: "bg-orange-500 text-white font-bold border-orange-600 shadow-xs",
        curValue: `주간 누적 ${curHrs.toFixed(1)}시간`,
        targetValue: `주 ${cfg.targetHours}시간 기준`,
        reason: `주간 누적 ${curHrs.toFixed(1)}시간으로 주 ${cfg.targetHours}시간 이상 도달`,
        nextCondition: "조정 불가 (이미 발생 확정)",
        resolution: "이미 발생 확정 — 조정 불가, 주휴수당 지급 처리 안내로 전환",
        curHours: curHrs,
      };
    } else if (curHrs >= cfg.level3Min) {
      const margin = Math.max(0.1, cfg.confirmedMin - curHrs).toFixed(1);
      weeklyBadge = {
        category: "주휴수당",
        level: "level3",
        levelNum: 3,
        text: "주휴수당 발생 3단계",
        color: "bg-rose-100 text-rose-700 border-rose-300 font-semibold",
        curValue: `주간 누적 ${curHrs.toFixed(1)}시간`,
        targetValue: `주 ${cfg.targetHours}시간 기준`,
        reason: `주간 누적 ${cfg.level3Min}~${cfg.level3Max}시간 구간에 해당하여 3단계 안내`,
        nextCondition: `${cfg.confirmedMin}시간 이상 도달 시 확정 단계로 전환`,
        resolution: `이번 주 잔여 근무를 ${margin}시간 이내로 조정하면 ${cfg.targetHours}시간 미만 유지 가능 (남은 여유시간 임박)`,
        curHours: curHrs,
        remainingHours: margin,
      };
    } else if (curHrs >= cfg.level2Min) {
      const margin = Math.max(0.1, cfg.confirmedMin - curHrs).toFixed(1);
      weeklyBadge = {
        category: "주휴수당",
        level: "level2",
        levelNum: 2,
        text: "주휴수당 발생 2단계",
        color: "bg-amber-100 text-amber-800 border-amber-300 font-semibold",
        curValue: `주간 누적 ${curHrs.toFixed(1)}시간`,
        targetValue: `주 ${cfg.targetHours}시간 기준`,
        reason: `주간 누적 ${cfg.level2Min}~${cfg.level2Max}시간 구간에 해당하여 2단계 안내`,
        nextCondition: `${cfg.level3Min}시간 이상 도달 시 3단계로 전환`,
        resolution: `이번 주 잔여 근무를 ${margin}시간 이내로 조정하면 ${cfg.targetHours}시간 미만 유지 가능`,
        curHours: curHrs,
        remainingHours: margin,
      };
    } else if (curHrs >= cfg.level1Min) {
      weeklyBadge = {
        category: "주휴수당",
        level: "level1",
        levelNum: 1,
        text: "주휴수당 발생 1단계",
        color: "bg-blue-100 text-blue-700 border-blue-200 font-semibold",
        curValue: `주간 누적 ${curHrs.toFixed(1)}시간`,
        targetValue: `주 ${cfg.targetHours}시간 기준`,
        reason: `주간 누적 ${cfg.level1Min}~${cfg.level1Max}시간 구간에 해당하여 1단계 안내`,
        nextCondition: `${cfg.level2Min}시간 이상 도달 시 2단계로 전환`,
        resolution: null,
        curHours: curHrs,
      };
    }
  }

  // 2. 4대보험 (socialInsurance) - 전 고용형태 공통
  let insuranceBadge = null;
  {
    const empAtt = attendanceList ? attendanceList.filter((a) => a.employeeId === emp.id && a.type === "정상출근") : [];
    const mHours = empAtt.reduce((sum, a) => sum + (a.totalHours || a.hours || 0), 0);
    const mDays = new Set(empAtt.map((a) => a.date)).size;
    const hourlyWage = emp.employmentType === "정직원" ? 12000 : 10030;

    const currDate = new Date(currentDateStr);
    const dayOfMonth = currDate.getDate(); // 1 ~ 31
    const daysInMonth = new Date(currDate.getFullYear(), currDate.getMonth() + 1, 0).getDate();
    const monthProgress = dayOfMonth / daysInMonth;

    const idNum = parseInt(String(emp.id).replace(/\D/g, "") || "1", 10);
    // 한 달에 최대 50 ~ 75시간, 6 ~ 12일 배정받는다고 가정
    const maxMonthHours = ((idNum * 13) % 25) + 50; 
    const maxMonthDays = ((idNum * 3) % 6) + 6;

    const simHours = mHours > 0 ? mHours : Math.round(maxMonthHours * monthProgress * 10) / 10;
    const simDays = mDays > 0 ? mDays : Math.round(maxMonthDays * monthProgress);
    const curIncome = Math.round((simHours * hourlyWage) / 10000);
    const cfg = activeCfg.socialInsurance || DEFAULT_LABOR_CONFIG.socialInsurance;

    if (simHours >= cfg.confirmedHoursMin || simDays >= cfg.confirmedDaysMin || curIncome >= cfg.confirmedIncomeMin) {
      insuranceBadge = {
        category: "4대보험",
        level: "confirmed",
        levelNum: 4,
        text: "4대보험 발생 확정",
        color: "bg-orange-500 text-white font-bold border-orange-600 shadow-xs",
        curValue: `월 누적 근로시간 ${simHours.toFixed(1)}시간 / ${simDays}일 / 월소득 ${curIncome}만원`,
        targetValue: `${cfg.targetHours}시간 이상 또는 ${cfg.targetDays}일 이상 또는 월소득 ${cfg.targetIncome}만원 이상`,
        reason: `월 ${cfg.confirmedHoursMin}시간 이상 또는 ${cfg.confirmedDaysMin}일 이상 요건 충족`,
        nextCondition: "조정 불가 (이미 발생 확정)",
        resolution: "이미 발생 확정 — 조정 불가, 가입 처리 안내로 전환",
        curHours: simHours,
        curDays: simDays,
        curIncome,
      };
    } else if (simHours >= cfg.level3HoursMin || simDays >= cfg.level3DaysMin) {
      const margin = Math.max(0.5, cfg.confirmedHoursMin - simHours).toFixed(1);
      insuranceBadge = {
        category: "4대보험",
        level: "level3",
        levelNum: 3,
        text: "4대보험 발생 3단계",
        color: "bg-rose-100 text-rose-700 border-rose-300 font-semibold",
        curValue: `월 누적 근로시간 ${simHours.toFixed(1)}시간 / ${simDays}일 / 월소득 ${curIncome}만원`,
        targetValue: `${cfg.targetHours}시간 이상 또는 ${cfg.targetDays}일 이상`,
        reason: `월 ${cfg.level3HoursMin}~${cfg.level3HoursMax}시간 구간에 해당하여 3단계 안내`,
        nextCondition: `${cfg.confirmedHoursMin}시간 이상 도달 시 확정 단계로 전환`,
        resolution: `이번 달 잔여 근무를 ${margin}시간 이내로 조정하면 ${cfg.targetHours}시간 미만 유지 가능 (근무일수 8일 임박 시 추가 근무 정지 옵션 제시)`,
        curHours: simHours,
        curDays: simDays,
        curIncome,
      };
    } else if (simHours >= cfg.level2HoursMin || simDays >= cfg.level2DaysMin) {
      const margin = Math.max(0.5, cfg.confirmedHoursMin - simHours).toFixed(1);
      insuranceBadge = {
        category: "4대보험",
        level: "level2",
        levelNum: 2,
        text: "4대보험 발생 2단계",
        color: "bg-amber-100 text-amber-800 border-amber-300 font-semibold",
        curValue: `월 누적 근로시간 ${simHours.toFixed(1)}시간 / ${simDays}일 / 월소득 ${curIncome}만원`,
        targetValue: `${cfg.targetHours}시간 이상 또는 ${cfg.targetDays}일 이상`,
        reason: `월 ${cfg.level2HoursMin}~${cfg.level2HoursMax}시간 구간에 해당하여 2단계 안내`,
        nextCondition: `${cfg.level3HoursMin}시간 이상 도달 시 3단계로 전환`,
        resolution: `이번 달 잔여 근무를 ${margin}시간 이내로 조정하면 ${cfg.targetHours}시간 미만 유지 가능합니다.`,
        curHours: simHours,
        curDays: simDays,
        curIncome,
      };
    } else if (simHours >= cfg.level1HoursMin || simDays >= cfg.level1DaysMin) {
      insuranceBadge = {
        category: "4대보험",
        level: "level1",
        levelNum: 1,
        text: "4대보험 발생 1단계",
        color: "bg-blue-100 text-blue-700 border-blue-200 font-semibold",
        curValue: `월 누적 근로시간 ${simHours.toFixed(1)}시간 / ${simDays}일 / 월소득 ${curIncome}만원`,
        targetValue: `${cfg.targetHours}시간 이상 또는 ${cfg.targetDays}일 이상`,
        reason: `월 ${cfg.level1HoursMin}~${cfg.level1HoursMax}시간 구간에 해당하여 1단계 안내`,
        nextCondition: `${cfg.level2HoursMin}시간 이상 도달 시 2단계로 전환`,
        resolution: null,
        curHours: simHours,
        curDays: simDays,
        curIncome,
      };
    }
  }

  // 3. 퇴직금 (severance) - 전 고용형태 공통
  let severanceBadge = null;
  {
    const cfg = activeCfg.severance || DEFAULT_LABOR_CONFIG.severance;
    let elapsedMonths = getElapsedMonths(emp.hireDate);
    
    const idNum = parseInt(String(emp.id).replace(/\D/g, "") || "1", 10);
    if (!emp.hireDate || elapsedMonths === 0) {
      elapsedMonths = (idNum * 2.3) % 14;
    }
    const elapsedInt = Math.floor(elapsedMonths);

    if (elapsedInt >= cfg.confirmedMonths) {
      severanceBadge = {
        category: "퇴직금",
        level: "confirmed",
        levelNum: 4,
        text: "퇴직금 발생 확정",
        color: "bg-orange-500 text-white font-bold border-orange-600 shadow-xs",
        curValue: `입사 후 ${elapsedInt}개월 경과`,
        targetValue: `입사 후 만 1년 (${cfg.targetMonths}개월) 도달`,
        reason: `입사 후 만 1년 도달 (근속 1년 + 주 15시간 이상)`,
        nextCondition: "조정 불가 (퇴직금 발생 확정)",
        resolution: "0개월 후 퇴직금 발생 — 정산 처리 안내 + 회계팀 알림 자동 전송",
        elapsedMonths: elapsedInt,
      };
    } else if (elapsedInt >= cfg.level3Months) {
      const monthsLeft = cfg.targetMonths - elapsedInt;
      severanceBadge = {
        category: "퇴직금",
        level: "level3",
        levelNum: 3,
        text: `퇴직금 발생 2개월전`,
        color: "bg-rose-100 text-rose-700 border-rose-300 font-semibold",
        curValue: `입사 후 ${elapsedInt}개월 경과`,
        targetValue: `입사 후 만 1년 (근속 1년 + 주 15시간 이상)`,
        reason: `만 1년 대비 2개월 전 시점 안내`,
        nextCondition: `입사 후 ${cfg.confirmedMonths}개월 (만 1년) 도달 시 퇴직금 발생 확정 단계로 전환`,
        resolution: `${monthsLeft}개월 후 퇴직금 발생`,
        elapsedMonths: elapsedInt,
      };
    } else if (elapsedInt >= cfg.level2Months) {
      const monthsLeft = cfg.targetMonths - elapsedInt;
      severanceBadge = {
        category: "퇴직금",
        level: "level2",
        levelNum: 2,
        text: `퇴직금 발생 4개월전`,
        color: "bg-amber-100 text-amber-800 border-amber-300 font-semibold",
        curValue: `입사 후 ${elapsedInt}개월 경과`,
        targetValue: `입사 후 만 1년 (근속 1년 + 주 15시간 이상)`,
        reason: `만 1년 대비 4개월 전 시점 안내`,
        nextCondition: `입사 후 ${cfg.level3Months}개월 경과 시 2개월전 단계로 전환`,
        resolution: `${monthsLeft}개월 후 퇴직금 발생`,
        elapsedMonths: elapsedInt,
      };
    } else if (elapsedInt >= cfg.level1Months) {
      severanceBadge = {
        category: "퇴직금",
        level: "level1",
        levelNum: 1,
        text: `퇴직금 발생 6개월전`,
        color: "bg-blue-100 text-blue-700 border-blue-200 font-semibold",
        curValue: `입사 후 ${elapsedInt}개월 경과`,
        targetValue: `입사 후 만 1년 (근속 1년 + 주 15시간 이상)`,
        reason: `입사 후 6개월 경과 시점 안내`,
        nextCondition: `입사 후 ${cfg.level2Months}개월 경과 시 4개월전 단계로 전환`,
        resolution: null,
        elapsedMonths: elapsedInt,
      };
    }
  }

  const badges = [weeklyBadge, insuranceBadge, severanceBadge].filter(Boolean);
  const highestLevelNum = Math.max(0, ...badges.map((b) => b.levelNum));

  return {
    weeklyBadge,
    insuranceBadge,
    severanceBadge,
    badges,
    highestLevelNum,
  };
}

function BadgeDetailModal({ isOpen, onClose, emp, badge, onAction }) {
  if (!isOpen || !emp || !badge) return null;

  const showResolution = badge.levelNum >= 2;


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-5 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 p-1.5 rounded-full hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-xs px-2.5 py-0.5 rounded-md font-bold border ${badge.color}`}>
              {badge.category} · {badge.level === "confirmed" ? "확정" : `${badge.levelNum}단계`}
            </span>
            <span className="text-xs text-slate-500 font-semibold bg-slate-100 px-2 py-0.5 rounded-md">
              {emp.storeCode || "매장"}
            </span>
          </div>
          <h3 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <span>{emp.name}</span>
            <span className="text-xs font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-md">
              {emp.employmentType}
            </span>
          </h3>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 text-sm">
          <div className="flex justify-between items-start">
            <span className="font-semibold text-slate-500 w-28 shrink-0">현재 수치</span>
            <span className="font-bold text-slate-900 text-right">{badge.curValue}</span>
          </div>
          <div className="flex justify-between items-start">
            <span className="font-semibold text-slate-500 w-28 shrink-0">기준 수치</span>
            <span className="font-medium text-slate-700 text-right">{badge.targetValue}</span>
          </div>
          <div className="flex justify-between items-start">
            <span className="font-semibold text-slate-500 w-28 shrink-0">단계 판정 이유</span>
            <span className="font-medium text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-right">
              "{badge.reason}"
            </span>
          </div>
          <div className="flex justify-between items-start">
            <span className="font-semibold text-slate-500 w-28 shrink-0">다음 단계 전환</span>
            <span className="font-medium text-slate-700 text-right">"{badge.nextCondition}"</span>
          </div>
        </div>

        {showResolution && badge.resolution ? (
          <div className="bg-orange-50/90 border-2 border-orange-200 rounded-xl p-4 space-y-2">
            <div className="text-xs font-bold text-orange-800 tracking-wider flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-orange-600" />
              <span>── 해결 방안 (2단계 이상 노출) ──</span>
            </div>
            <p className="text-sm font-bold text-slate-800 leading-relaxed">
              "{badge.resolution}"
            </p>
          </div>
        ) : (
          <div className="text-xs text-slate-500 bg-slate-100 p-3 rounded-xl">
            💡 1단계 및 확정 단계는 참고용 안내로 제공되며, 별도 스케줄 조정 제안이 표시되지 않습니다.
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
          {showResolution && badge.level !== "confirmed" && (
            <>
              <button
                type="button"
                onClick={() => onAction && onAction("schedule_proposal", emp, badge)}
                className="px-3.5 py-2 bg-orange-100 text-orange-900 hover:bg-orange-200 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                [스케줄 조정 제안 보기]
              </button>
              <button
                type="button"
                onClick={() => onAction && onAction("stop_extra_work", emp, badge)}
                className="px-3.5 py-2 bg-rose-100 text-rose-900 hover:bg-rose-200 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                [이번 달 추가 근무 정지]
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 text-white hover:bg-slate-900 text-xs font-bold rounded-xl transition-colors cursor-pointer"
          >
            [닫기]
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PayrollFlowPrototype() {
  const [currentUserRole, setCurrentUserRole] = useState("accounting");
  const [currentStoreCode, setCurrentStoreCode] = useState("고메스퀘어 부천점");

  const [role, setRole] = useState("accounting");
  const [accountingSubtab, setAccountingSubtab] = useState("confirm");
  const [hrSubtab, setHrSubtab] = useState("confirm");

  // 직원 관리 탭 관련 State
  const [empManagementTab, setEmpManagementTab] = useState("working"); // working, resigned, search
  const [empSearchTerm, setEmpSearchTerm] = useState("");
  const [empSortConfig, setEmpSortConfig] = useState({ key: "storeCode", direction: "asc" }); // 정렬 상태
  const [selectedEmpProfile, setSelectedEmpProfile] = useState(null); // 모달 표시용 직원 정보
  const [dismissedSuspectedAlerts, setDismissedSuspectedAlerts] = useState([]); // 퇴직 의심 알림 닫기 상태
  const [dismissedSeveranceAlerts, setDismissedSeveranceAlerts] = useState([]); // 퇴직금 발생 알림 닫기 상태
  
  // 공휴일 추가 커스텀 모달 State
  const [isHolidayModalOpen, setIsHolidayModalOpen] = useState(false);
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");
  
  // 연차/휴무일 관리 State (localStorage 연동)
  const [companyHolidays, setCompanyHolidays] = useState(() => {
    try {
      const saved = localStorage.getItem("company_holidays");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [
      { id: 1, date: "2025-01-01", name: "신정" },
      { id: 2, date: "2025-01-28", name: "설날 연휴" },
      { id: 3, date: "2025-01-29", name: "설날 당일" },
      { id: 4, date: "2025-01-30", name: "설날 연휴" },
      { id: 5, date: "2025-03-01", name: "삼일절" }
    ];
  });
  
  const [leaveBalances, setLeaveBalances] = useState(() => {
    try {
      const saved = localStorage.getItem("leave_balances");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {}
    return {};
  });

  // 변경 시 로컬스토리지 자동 저장
  useEffect(() => {
    localStorage.setItem("company_holidays", JSON.stringify(companyHolidays));
  }, [companyHolidays]);

  useEffect(() => {
    localStorage.setItem("leave_balances", JSON.stringify(leaveBalances));
  }, [leaveBalances]); 

  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [stores, setStores] = useState([]);
  
  const [storeTab, setStoreTab] = useState("attendance");
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  // 사원 수정 ID & 매장 수정 ID
  const [editingEmpId, setEditingEmpId] = useState(null);
  const [editingStoreId, setEditingStoreId] = useState(null);

  // 근로조건 설정 Config 상태 (localStorage 연동)
  const [laborConfig, setLaborConfig] = useState(() => {
    try {
      const saved = localStorage.getItem("payroll_labor_config");
      return saved ? JSON.parse(saved) : DEFAULT_LABOR_CONFIG;
    } catch (e) {
      return DEFAULT_LABOR_CONFIG;
    }
  });

  // Config 수정 폼 상태
  const [configForm, setConfigForm] = useState(laborConfig);

  useEffect(() => {
    setConfigForm(laborConfig);
  }, [laborConfig]);

  // 뱃지 상세 팝업 상태
  const [badgeModalData, setBadgeModalData] = useState({
    isOpen: false,
    emp: null,
    badge: null,
  });

  // 회계팀 근로조건 보드판 필터 (all | actionable)
  const [laborBoardFilter, setLaborBoardFilter] = useState("all");

  const openBadgeModal = (emp, badge) => {
    setBadgeModalData({ isOpen: true, emp, badge });
  };

  const handleBadgeAction = (actionType, emp, badge) => {
    if (actionType === "schedule_proposal") {
      flash(`[${emp.name}] 스케줄 조정 제안: "${badge.resolution}"`);
    } else if (actionType === "stop_extra_work") {
      flash(`[${emp.name}] 이번 달 추가 근무 정지가 적용되었습니다.`);
    }
    setBadgeModalData({ isOpen: false, emp: null, badge: null });
  };

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

    // 중복 체크 로직 (A안: 경고 후 허용)
    if (!editingEmpId) {
      const duplicateEmp = employees.find(
        (e) => e.ssn === form.ssn || (form.account && e.account === form.account)
      );
      if (duplicateEmp) {
        const confirmMsg = `입력하신 주민등록번호(또는 계좌번호)는 이미 [${duplicateEmp.storeCode}] 매장에 등록된 이력(${duplicateEmp.name})이 있습니다.\n매장 이동이나 겸직 처리를 위해 신규 등록을 강행하시겠습니까?`;
        if (!window.confirm(confirmMsg)) {
          return; // 등록 취소
        }
      }
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

  // ---------------- 🗓️ 매장 근태 입력 엑셀형/그리드형 상태 관리 ----------------
  const todayStr = useMemo(() => getKstDateString(new Date()) || "2026-08-13", []);
  const [attGlobalDate, setAttGlobalDate] = useState(todayStr);
  const [attTimeMode, setAttTimeMode] = useState("start-end"); // "start-end" | "start-hours" | "start-only"
  const [attTargetTab, setAttTargetTab] = useState("fulltime"); // "fulltime" | "parttime" | "daily"
  
  // 아르바이트 & 일용직 선택 체크박스 상태
  const [selectedFulltimeIds, setSelectedFulltimeIds] = useState(new Set());
  const [selectedParttimeIds, setSelectedParttimeIds] = useState(new Set());
  const [selectedDailyIds, setSelectedDailyIds] = useState(new Set());

  // 우측 작업창에 불러와진 행(Row) 목록
  const [loadedRows, setLoadedRows] = useState([]);

  // 매장별 사원 고용형태 분류 (가나다순 정렬)
  const fulltimeEmps = useMemo(() => {
    return currentStoreEmployees
      .filter((e) => e.employmentType === "정직원")
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [currentStoreEmployees]);

  const parttimeEmps = useMemo(() => {
    return currentStoreEmployees
      .filter((e) => e.employmentType === "아르바이트")
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [currentStoreEmployees]);

  const dailyEmps = useMemo(() => {
    return currentStoreEmployees
      .filter((e) => e.employmentType === "일용직")
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [currentStoreEmployees]);

  // ── 🔒 과거 날짜 근태 수정 권한 검증 헬퍼 (매장 불가 / 본사 회계팀 가능) ──
  const checkEditPermission = () => {
    const isPastDate = attGlobalDate < todayStr;
    const isStoreUser = role === "store";
    if (isStoreUser && isPastDate) {
      flash("지난자료는 수정이 불가능합니다. 본사 회계팀을 통해 수정하세요", "error");
      return false;
    }
    return true;
  };

  // 1. 정직원 전체 우측 작업창으로 가져오기
  const importAllFulltime = () => {
    if (!checkEditPermission()) return;
    if (fulltimeEmps.length === 0) {
      flash("가져올 정직원이 없습니다. 사원등록을 확인하세요.", "error");
      return;
    }
    const newRows = [...loadedRows];
    let count = 0;
    fulltimeEmps.forEach((emp) => {
      const exists = newRows.some((r) => r.empId === emp.id && r.date === attGlobalDate);
      if (!exists) {
        newRows.push({
          rowId: `ft_${emp.id}_${Date.now()}_${Math.random()}`,
          empId: emp.id,
          name: emp.name,
          employmentType: "정직원",
          deptPosition: [emp.dept, emp.position].filter(Boolean).join(" · ") || "정직원",
          date: attGlobalDate,
          type: "정상출근",
          mode: attTimeMode,
          start: "09:00",
          end: "18:00",
          hours: attTimeMode === "start-only" ? 10 : 8,
          breakMinutes: 0,
        });
        count++;
      }
    });
    setLoadedRows(newRows);
    flash(`정직원 ${count}명을 우측 작업창으로 가져왔습니다!`);
  };

  // 1-5. 선택한 정직원 우측 작업창으로 가져오기
  const importSelectedFulltime = () => {
    if (!checkEditPermission()) return;
    if (selectedFulltimeIds.size === 0) {
      flash("가져올 정직원을 체크 선택하세요.", "error");
      return;
    }
    const newRows = [...loadedRows];
    let count = 0;
    fulltimeEmps.forEach((emp) => {
      if (selectedFulltimeIds.has(emp.id)) {
        const exists = newRows.some((r) => r.empId === emp.id && r.date === attGlobalDate);
        if (!exists) {
          newRows.push({
            rowId: `ft_${emp.id}_${Date.now()}_${Math.random()}`,
            empId: emp.id,
            name: emp.name,
            employmentType: "정직원",
            deptPosition: [emp.dept, emp.position].filter(Boolean).join(" · ") || "정직원",
            date: attGlobalDate,
            type: "정상출근",
            mode: attTimeMode,
            start: "09:00",
            end: "18:00",
            hours: attTimeMode === "start-only" ? 10 : 8,
            breakMinutes: 0,
          });
          count++;
        }
      }
    });
    setLoadedRows(newRows);
    setSelectedFulltimeIds(new Set());
    flash(`정직원 ${count}명을 우측 작업창으로 가져왔습니다!`);
  };

  const importAllParttime = () => {
    if (!checkEditPermission()) return;
    if (parttimeEmps.length === 0) {
      flash("가져올 아르바이트가 없습니다.", "error");
      return;
    }
    const newRows = [...loadedRows];
    let count = 0;
    parttimeEmps.forEach((emp) => {
      const exists = newRows.some((r) => r.empId === emp.id && r.date === attGlobalDate);
      if (!exists) {
        newRows.push({
          rowId: `pt_${emp.id}_${Date.now()}_${Math.random()}`,
          empId: emp.id,
          name: emp.name,
          employmentType: "아르바이트",
          deptPosition: "아르바이트",
          date: attGlobalDate,
          type: "정상출근",
          mode: attTimeMode,
          start: "09:00",
          end: "18:00",
          hours: attTimeMode === "start-only" ? 10 : 8,
          breakMinutes: 60,
        });
        count++;
      }
    });
    setLoadedRows(newRows);
    flash(`아르바이트 ${count}명을 우측 작업창으로 가져왔습니다!`);
  };

  const importAllDaily = () => {
    if (!checkEditPermission()) return;
    if (dailyEmps.length === 0) {
      flash("가져올 일용직이 없습니다.", "error");
      return;
    }
    const newRows = [...loadedRows];
    let count = 0;
    dailyEmps.forEach((emp) => {
      const exists = newRows.some((r) => r.empId === emp.id && r.date === attGlobalDate);
      if (!exists) {
        newRows.push({
          rowId: `dy_${emp.id}_${Date.now()}_${Math.random()}`,
          empId: emp.id,
          name: emp.name,
          employmentType: "일용직",
          deptPosition: "일용직",
          date: attGlobalDate,
          type: "정상출근",
          mode: attTimeMode,
          start: "09:00",
          end: "18:00",
          hours: attTimeMode === "start-only" ? 10 : 8,
          breakMinutes: 0,
        });
        count++;
      }
    });
    setLoadedRows(newRows);
    flash(`일용직 ${count}명을 우측 작업창으로 가져왔습니다!`);
  };

  // 2. 선택한 아르바이트 우측 작업창으로 가져오기
  const importSelectedParttime = () => {
    if (!checkEditPermission()) return;
    if (selectedParttimeIds.size === 0) {
      flash("가져올 아르바이트생을 체크 선택하세요.", "error");
      return;
    }
    const newRows = [...loadedRows];
    let count = 0;
    parttimeEmps.forEach((emp) => {
      if (selectedParttimeIds.has(emp.id)) {
        const exists = newRows.some((r) => r.empId === emp.id && r.date === attGlobalDate);
        if (!exists) {
          newRows.push({
            rowId: `pt_${emp.id}_${Date.now()}_${Math.random()}`,
            empId: emp.id,
            name: emp.name,
            employmentType: "아르바이트",
            deptPosition: "아르바이트",
            date: attGlobalDate,
            type: "정상출근",
            mode: attTimeMode,
            start: "09:00",
            end: "18:00",
            hours: attTimeMode === "start-only" ? 10 : 8,
            breakMinutes: 60, // 기본 휴게 60분
          });
          count++;
        }
      }
    });
    setLoadedRows(newRows);
    setSelectedParttimeIds(new Set());
    flash(`아르바이트생 ${count}명을 우측 작업창으로 가져왔습니다!`);
  };

  // 3. 선택한 일용직 우측 작업창으로 가져오기
  const importSelectedDaily = () => {
    if (!checkEditPermission()) return;
    if (selectedDailyIds.size === 0) {
      flash("가져올 일용직 인원을 체크 선택하세요.", "error");
      return;
    }
    const newRows = [...loadedRows];
    let count = 0;
    dailyEmps.forEach((emp) => {
      if (selectedDailyIds.has(emp.id)) {
        const exists = newRows.some((r) => r.empId === emp.id && r.date === attGlobalDate);
        if (!exists) {
          newRows.push({
            rowId: `dy_${emp.id}_${Date.now()}_${Math.random()}`,
            empId: emp.id,
            name: emp.name,
            employmentType: "일용직",
            deptPosition: "일용직",
            date: attGlobalDate,
            type: "정상출근",
            mode: attTimeMode,
            start: "09:00",
            end: "18:00",
            hours: attTimeMode === "start-only" ? 10 : 8,
            breakMinutes: 0,
          });
          count++;
        }
      }
    });
    setLoadedRows(newRows);
    setSelectedDailyIds(new Set());
    flash(`일용직 ${count}명을 우측 작업창으로 가져왔습니다!`);
  };

  // 로드된 행 제거 (X 버튼)
  const removeLoadedRow = (rowId) => {
    if (!checkEditPermission()) return;
    setLoadedRows((prev) => prev.filter((r) => r.rowId !== rowId));
  };

  // 로드된 행 데이터 개별 변경
  const updateRow = (rowId, key, val) => {
    if (!checkEditPermission()) return;
    setLoadedRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, [key]: val } : r))
    );
  };

  // 전역 날짜 변경 시 선택한 날짜의 기존 저장 데이터 자동 조회 & 로드
  const handleGlobalDateChange = (newDate) => {
    setAttGlobalDate(newDate);
    const dateAtt = attendance.filter((a) => a.date === newDate);
    if (dateAtt.length > 0) {
      const rows = dateAtt.map((a) => {
        const emp = currentStoreEmployees.find((e) => e.id === a.employeeId || String(e.id) === String(a.employeeId));
        return {
          rowId: a.id || `att_${a.employeeId}_${newDate}`,
          empId: a.employeeId,
          name: emp ? emp.name : (a.name || "사원"),
          employmentType: emp ? emp.employmentType : (a.employmentType || "아르바이트"),
          deptPosition: emp ? [emp.dept, emp.position].filter(Boolean).join(" · ") : "사원",
          date: newDate,
          type: a.type || "정상출근",
          mode: a.mode || "start-only",
          start: a.start || "09:00",
          end: a.end || "18:00",
          hours: a.hours !== undefined ? a.hours : (a.totalHours || 8),
          breakMinutes: a.breakMinutes || 0,
        };
      });
      setLoadedRows(rows);
    } else {
      setLoadedRows([]);
    }
  };

  // 전역 근무시간 입력방식 변경 시 로드된 행 입력방식 일괄 변경
  const handleGlobalTimeModeChange = (newMode) => {
    if (!checkEditPermission()) return;
    setAttTimeMode(newMode);
    setLoadedRows((prev) => prev.map((r) => {
      const newHours = newMode === "start-only" ? 10 : r.hours;
      return { ...r, mode: newMode, hours: newHours };
    }));
  };

  // 행의 실제 계산된 수당 인정 근로시간 계산
  const computeRowHours = (row) => {
    let rawHours = 0;
    if (row.mode === "start-only") {
      rawHours = row.hours !== undefined ? Number(row.hours) : 10;
    } else if (row.mode === "start-hours") {
      rawHours = Number(row.hours) || 0;
    } else if (row.mode === "start-end" && row.start && row.end) {
      const [sh, sm] = row.start.split(":").map(Number);
      const [eh, em] = row.end.split(":").map(Number);
      const diff = (eh * 60 + em - (sh * 60 + sm)) / 60;
      rawHours = diff > 0 ? Math.round(diff * 10) / 10 : 0;
    }

    // 아르바이트의 경우 휴게시간(분) 차감
    if (row.employmentType === "아르바이트" && row.breakMinutes) {
      const breakHours = (Number(row.breakMinutes) || 0) / 60;
      rawHours = Math.max(0, Math.round((rawHours - breakHours) * 10) / 10);
    }
    return rawHours;
  };

  // 우측 작업창의 전체 인원 근태 일괄 저장 (Firestore)
  const saveAllLoadedRows = async () => {
    if (!checkEditPermission()) return;
    if (loadedRows.length === 0) {
      flash("우측 작업창에 저장할 근태 행이 없습니다.", "error");
      return;
    }
    try {
      const editorRole = role === "store" ? "store_user" : "accounting_user";
      for (const row of loadedRows) {
        const totalHrs = computeRowHours(row);
        const payload = {
          employeeId: row.empId,
          date: row.date || attGlobalDate,
          type: row.type || "정상출근",
          mode: row.mode,
          start: row.start || "",
          end: row.end || "",
          hours: totalHrs,
          totalHours: totalHrs,
          breakMinutes: row.breakMinutes || 0,
        };
        await firebaseService.submitAttendance(payload, currentStoreCode, editorRole);
      }
      if (role !== "store" && attGlobalDate < todayStr) {
        flash(`🎉 [본사 회계팀 권한] 지난 근태 기록 (${attGlobalDate})이 DB에 즉각 수정/반영되었습니다!`);
      } else {
        flash(`🎉 총 ${loadedRows.length}명의 근태 기록이 성공적으로 일괄 저장되었습니다!`);
      }
      setLoadedRows([]);
    } catch (err) {
      flash(err.message || "일괄 저장 중 오류가 발생했습니다.", "error");
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

  const suspectedResignations = useMemo(() => {
    const todayDate = new Date(attGlobalDate || "2025-02-13");
    return employees.filter(e => {
      if (e.resignDate) return false;
      if (e.employmentType === "일용직") return false;
      if (dismissedSuspectedAlerts.includes(e.id)) return false;
      
      const empAtts = attendance.filter(a => a.empId === e.id);
      let lastDateStr = e.hireDate;
      if (empAtts.length > 0) {
        const sorted = [...empAtts].sort((a,b) => new Date(b.date) - new Date(a.date));
        lastDateStr = sorted[0].date;
      }
      if (!lastDateStr) return false;
      
      const lastDate = new Date(lastDateStr);
      const diffTime = todayDate.getTime() - lastDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays >= 14;
    });
  }, [employees, attendance, attGlobalDate, dismissedSuspectedAlerts]);

  const allResignedEmployees = useMemo(() => {
    return [...employees].filter(e => e.resignDate).sort((a,b) => new Date(b.resignDate) - new Date(a.resignDate));
  }, [employees]);


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

  // 근로조건 이슈 전체 평가 (오직 아르바이트 사원만 대상)
  const allLaborEvaluations = useMemo(() => {
    return employees
      .filter((e) => e.employmentType === "아르바이트")
      .map((e) => {
        const evalRes = evaluateEmployeeLaborConditions(e, attendance, laborConfig, attGlobalDate);
        return {
          emp: e,
          evalRes,
        };
      });
  }, [employees, attendance, laborConfig]);

  // 퇴직금 발생 확정 인원 (회계팀 알림 연동 대상)
  const confirmedSeveranceEmps = useMemo(() => {
    return allLaborEvaluations.filter((item) => {
      if (dismissedSeveranceAlerts.includes(item.emp.id)) return false;
      return item.evalRes.severanceBadge?.level === "confirmed";
    });
  }, [allLaborEvaluations, dismissedSeveranceAlerts]);

  // 2단계 이상 이슈 대상 사원들
  const actionableLaborEmps = useMemo(() => {
    return allLaborEvaluations.filter((item) => item.evalRes.highestLevelNum >= 2);
  }, [allLaborEvaluations]);

  // --- 휴무일 근무 및 연차 파생 데이터 ---
  const leaveStats = useMemo(() => {
    let promoteCount = 0; 
    let settlementCount = 0; 
    let minusCount = 0; 
    
    const fulltimeList = employees.filter(e => e.employmentType === "정직원").map(e => {
      const curr = new Date(attGlobalDate);
      const hire = new Date(e.hireDate || "2024-01-01");
      let diffYears = curr.getFullYear() - hire.getFullYear();
      if (
        curr.getMonth() < hire.getMonth() ||
        (curr.getMonth() === hire.getMonth() && curr.getDate() < hire.getDate())
      ) {
        diffYears--;
      }
      const yearsOfService = Math.max(0, diffYears);
      const monthsOfService = (curr.getFullYear() - hire.getFullYear()) * 12 + (curr.getMonth() - hire.getMonth());
      
      let defaultTotal = 0;
      if (yearsOfService === 0) {
        defaultTotal = Math.max(0, monthsOfService); 
      } else {
        defaultTotal = 15 + Math.floor((yearsOfService - 1) / 2); 
        if (defaultTotal > 25) defaultTotal = 25; 
      }

      const userBal = leaveBalances[e.id] || { total: defaultTotal, used: 0 };
      const total = userBal.total;
      const used = userBal.used;
      const remain = total - used;

      if (remain < 0) minusCount++;
      if (e.resignDate && remain > 0) settlementCount++;
      
      const isPromote = (monthsOfService % 12 >= 6) && remain > 0;
      if (isPromote && !e.resignDate) promoteCount++;

      return {
        ...e,
        yearsOfService,
        monthsOfService,
        total,
        used,
        remain,
        isPromote
      };
    });
    
    return { list: fulltimeList, promoteCount, settlementCount, minusCount };
  }, [employees, leaveBalances, attGlobalDate]);

  const holidayWorkStats = useMemo(() => {
    // 반환 구조: [{ date: 'YYYY-MM-DD', name: '설날', stores: [{ storeName: '부천점', fulltime: 1, parttime: 2 }, ...] }]
    const result = [];
    
    companyHolidays.forEach(holiday => {
      // 해당 공휴일에 출근한 기록들 추출
      const holidayAtt = attendance.filter(a => a.type === "정상출근" && a.date === holiday.date);
      if (holidayAtt.length === 0) return; // 출근자가 없으면 스킵

      const storeMap = {};
      holidayAtt.forEach(a => {
        const emp = employees.find(e => e.id === a.employeeId);
        if (!emp) return;
        
        const sName = emp.storeCode;
        if (!storeMap[sName]) {
          storeMap[sName] = { storeName: sName, fulltime: 0, parttime: 0, daily: 0 };
        }
        
        if (emp.employmentType === "정직원") storeMap[sName].fulltime += 1;
        else if (emp.employmentType === "아르바이트") storeMap[sName].parttime += 1;
        else storeMap[sName].daily += 1;
      });

      result.push({
        date: holiday.date,
        name: holiday.name,
        stores: Object.values(storeMap)
      });
    });
    
    // 날짜 오름차순 정렬
    result.sort((a, b) => new Date(a.date) - new Date(b.date));
    return result;
  }, [attendance, companyHolidays, employees]);

  // --- 직원 관리 탭 (Employee Management) 파생 데이터 ---
  const { workingEmps, resignedEmps, searchResultEmps } = useMemo(() => {
    // 동적 정렬 함수
    const sortEmps = (empList) => {
      return [...empList].sort((a, b) => {
        let valA = a[empSortConfig.key] || "";
        let valB = b[empSortConfig.key] || "";
        
        if (empSortConfig.key === "hireDate" || empSortConfig.key === "resignDate") {
          valA = valA ? new Date(valA).getTime() : 0;
          valB = valB ? new Date(valB).getTime() : 0;
        }

        if (valA < valB) return empSortConfig.direction === "asc" ? -1 : 1;
        if (valA > valB) return empSortConfig.direction === "asc" ? 1 : -1;
        
        // 값이 같으면 매장코드 -> 이름순으로 2차 정렬
        if (a.storeCode !== b.storeCode) {
          return a.storeCode.localeCompare(b.storeCode);
        }
        return a.name.localeCompare(b.name);
      });
    };

    const working = sortEmps(employees.filter(e => !e.resignDate));
    const resigned = sortEmps(employees.filter(e => e.resignDate));
    
    let searched = [];
    if (empSearchTerm.trim()) {
      searched = sortEmps(
        employees.filter(e => e.name.toLowerCase().includes(empSearchTerm.toLowerCase().trim()))
      );
    }
    
    return { workingEmps: working, resignedEmps: resigned, searchResultEmps: searched };
  }, [employees, empSearchTerm, empSortConfig]);

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


  const renderAttendanceTab = () => {
    return (
              <div className="space-y-6">
                {/* 1. 상단 글로벌 컨트롤 바 (근무 날짜 & 근무시간 입력 방식 일괄 전환) */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-[#EF7D25] shrink-0">
                      <Calendar className="w-5.5 h-5.5" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">
                        전체 근태 대상 날짜 선택
                      </label>
                      <input
                        type="date"
                        value={attGlobalDate}
                        onChange={(e) => handleGlobalDateChange(e.target.value)}
                        className="bg-slate-50 border border-slate-300 rounded-xl px-4 py-2 text-base font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#EF7D25] shadow-xs cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-700">근무시간 입력 방식:</span>
                    <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200 gap-2">
                      {[
                        { key: "start-only", label: "⏱️ 시작+10시간" },
                        { key: "start-hours", label: "🔢 시작 + 총시간" },
                        { key: "start-end", label: "⌛ 시작 + 종료시간" },
                      ].map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => handleGlobalTimeModeChange(m.key)}
                          className={`text-sm px-4 py-2.5 rounded-xl font-extrabold transition-all cursor-pointer shadow-xs ${
                            attTimeMode === m.key
                              ? "bg-[#EF7D25] text-white ring-2 ring-orange-300"
                              : "bg-white text-slate-700 hover:bg-slate-50 border border-slate-200"
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 지난 날짜 안내 및 수정 제한 경고 바 */}
                {attGlobalDate < todayStr && (
                  <div className={`p-4 rounded-xl border flex items-center justify-between text-sm font-bold shadow-xs ${
                    role === "store"
                      ? "bg-rose-50 border-rose-200 text-rose-800"
                      : "bg-amber-50 border-amber-200 text-amber-900"
                  }`}>
                    <div className="flex items-center gap-2">
                      {role === "store" ? (
                        <>
                          <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
                          <span>🔒 지난 근태 기록 ({attGlobalDate}) 조회 중입니다. (매장 수정 불가 / 조회 전용 - 수정 필요 시 본사 회계팀 문의)</span>
                        </>
                      ) : (
                        <>
                          <Edit3 className="w-5 h-5 text-amber-600 shrink-0" />
                          <span>✏️ 지난 근태 기록 ({attGlobalDate}) — 본사 회계팀 수정 권한으로 작업 중 (저장 시 DB 즉각 반영됩니다).</span>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* 2. 좌측 인원 선택 & 우측 행 일괄 작업창 (좌우 분할 레이아웃) */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* 👈 좌측 패널: 상단 탭 3개 (정직원 / 아르바이트 / 일용직) 및 선택 리스트 */}
                  <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200/90 p-6 shadow-sm flex flex-col justify-between min-h-[580px]">
                    <div>
                      <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
                        <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                          <Users className="w-5 h-5 text-[#EF7D25]" />
                          인원 불러오기
                        </h2>
                        <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md">
                          "{currentStoreCode}"
                        </span>
                      </div>

                      {/* 탭 3개 버튼 */}
                      <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 mb-5">
                        <button
                          type="button"
                          onClick={() => setAttTargetTab("fulltime")}
                          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                            attTargetTab === "fulltime"
                              ? "bg-[#EF7D25] text-white shadow-xs"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          👔 정직원 ({fulltimeEmps.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setAttTargetTab("parttime")}
                          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                            attTargetTab === "parttime"
                              ? "bg-[#EF7D25] text-white shadow-xs"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          🐥 아르바이트 ({parttimeEmps.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setAttTargetTab("daily")}
                          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                            attTargetTab === "daily"
                              ? "bg-[#EF7D25] text-white shadow-xs"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          🏗️ 일용직 ({dailyEmps.length})
                        </button>
                      </div>

                      {/* 1. 정직원 탭 내용 (가나다순, 출근 안 해도 휴무/결근 처리 위해 전체 선택 가능) */}
                      {attTargetTab === "fulltime" && (
                        <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                          <div className="text-xs text-slate-500 mb-2 font-medium flex justify-between items-center">
                            <span>💡 출근/휴무 기입을 위해 정직원을 불러옵니다.</span>
                            <button
                              type="button"
                              onClick={() => {
                                if (selectedFulltimeIds.size === fulltimeEmps.length) setSelectedFulltimeIds(new Set());
                                else setSelectedFulltimeIds(new Set(fulltimeEmps.map(e => e.id)));
                              }}
                              className="text-[11px] text-[#EF7D25] underline font-bold cursor-pointer"
                            >
                              {selectedFulltimeIds.size === fulltimeEmps.length ? "전체해제" : "전체선택"}
                            </button>
                          </div>
                          {fulltimeEmps.length === 0 && (
                            <div className="text-xs text-slate-400 text-center py-10 border border-dashed rounded-xl">
                              등록된 정직원이 없습니다.
                            </div>
                          )}
                          {fulltimeEmps.map((e) => {
                            const evalRes = evaluateEmployeeLaborConditions(e, attendance, laborConfig, attGlobalDate);
                            const isChecked = selectedFulltimeIds.has(e.id);
                            return (
                              <label
                                key={e.id}
                                className={`p-3 border rounded-xl flex items-center justify-between text-sm cursor-pointer select-none transition-all ${
                                  isChecked
                                    ? "bg-orange-50/80 border-[#EF7D25] font-bold text-slate-900 shadow-xs"
                                    : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                                }`}
                              >
                                <div className="flex items-center gap-2 flex-wrap">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(ev) => {
                                      const next = new Set(selectedFulltimeIds);
                                      if (ev.target.checked) next.add(e.id);
                                      else next.delete(e.id);
                                      setSelectedFulltimeIds(next);
                                    }}
                                    className="w-4 h-4 text-[#EF7D25] rounded focus:ring-[#EF7D25] cursor-pointer"
                                  />
                                  <span className="font-bold text-slate-900">{e.name}</span>
                                  {evalRes.badges.length > 0 ? (
                                    evalRes.badges.map((b, idx) => (
                                      <button
                                        key={idx}
                                        type="button"
                                        onClick={() => openBadgeModal(e, b)}
                                        className={`text-[11px] px-2 py-0.5 rounded-md border transition-all cursor-pointer hover:opacity-80 ${b.color}`}
                                        title={`${b.category}: ${b.curValue}`}
                                      >
                                        {b.text}
                                      </button>
                                    ))
                                  ) : (
                                    <span className="text-[11px] text-slate-400 font-medium">입사: {e.hireDate}</span>
                                  )}
                                </div>
                                <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 shrink-0">
                                  👔 정직원
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}

                      {/* 2. 아르바이트 탭 내용 (체크박스 제공) */}
                      {attTargetTab === "parttime" && (
                        <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                          <div className="text-xs text-slate-500 mb-2 font-medium flex justify-between items-center">
                            <span>💡 오늘 출근한 아르바이트생을 체크하세요.</span>
                            <button
                              type="button"
                              onClick={() => {
                                if (selectedParttimeIds.size === parttimeEmps.length) {
                                  setSelectedParttimeIds(new Set());
                                } else {
                                  setSelectedParttimeIds(new Set(parttimeEmps.map((e) => e.id)));
                                }
                              }}
                              className="text-[11px] text-[#EF7D25] underline font-bold cursor-pointer"
                            >
                              {selectedParttimeIds.size === parttimeEmps.length ? "전체해제" : "전체선택"}
                            </button>
                          </div>
                          {parttimeEmps.length === 0 && (
                            <div className="text-xs text-slate-400 text-center py-10 border border-dashed rounded-xl">
                              등록된 아르바이트생이 없습니다.
                            </div>
                          )}
                          {parttimeEmps.map((e) => {
                            const isChecked = selectedParttimeIds.has(e.id);
                            const evalRes = evaluateEmployeeLaborConditions(e, attendance, laborConfig, attGlobalDate);
                            return (
                              <label
                                key={e.id}
                                className={`p-3 border rounded-xl flex items-center justify-between text-sm cursor-pointer select-none transition-all ${
                                  isChecked
                                    ? "bg-orange-50/80 border-[#EF7D25] font-bold text-slate-900 shadow-xs"
                                    : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                                }`}
                              >
                                <div className="flex items-center gap-2 flex-wrap">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(ev) => {
                                      const next = new Set(selectedParttimeIds);
                                      if (ev.target.checked) next.add(e.id);
                                      else next.delete(e.id);
                                      setSelectedParttimeIds(next);
                                    }}
                                    className="w-4 h-4 text-[#EF7D25] rounded focus:ring-[#EF7D25] cursor-pointer"
                                  />
                                  <span>{e.name}</span>
                                  {evalRes.badges.map((b, idx) => (
                                    <button
                                      key={idx}
                                      type="button"
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        ev.preventDefault();
                                        openBadgeModal(e, b);
                                      }}
                                      className={`text-[11px] px-2 py-0.5 rounded-md border transition-all cursor-pointer hover:opacity-80 ${b.color}`}
                                      title={`${b.category}: ${b.curValue}`}
                                    >
                                      {b.text}
                                    </button>
                                  ))}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}

                      {/* 3. 일용직 탭 내용 (체크박스 제공) */}
                      {attTargetTab === "daily" && (
                        <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                          <div className="text-xs text-slate-500 mb-2 font-medium flex justify-between items-center">
                            <span>💡 오늘 출근한 일용직을 체크하세요.</span>
                            <button
                              type="button"
                              onClick={() => {
                                if (selectedDailyIds.size === dailyEmps.length) {
                                  setSelectedDailyIds(new Set());
                                } else {
                                  setSelectedDailyIds(new Set(dailyEmps.map((e) => e.id)));
                                }
                              }}
                              className="text-[11px] text-[#EF7D25] underline font-bold cursor-pointer"
                            >
                              {selectedDailyIds.size === dailyEmps.length ? "전체해제" : "전체선택"}
                            </button>
                          </div>
                          {dailyEmps.length === 0 && (
                            <div className="text-xs text-slate-400 text-center py-10 border border-dashed rounded-xl">
                              등록된 일용직이 없습니다.
                            </div>
                          )}
                          {dailyEmps.map((e) => {
                            const isChecked = selectedDailyIds.has(e.id);
                            const evalRes = evaluateEmployeeLaborConditions(e, attendance, laborConfig, attGlobalDate);
                            return (
                              <label
                                key={e.id}
                                className={`p-3 border rounded-xl flex items-center justify-between text-sm cursor-pointer select-none transition-all ${
                                  isChecked
                                    ? "bg-orange-50/80 border-[#EF7D25] font-bold text-slate-900 shadow-xs"
                                    : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                                }`}
                              >
                                <div className="flex items-center gap-2 flex-wrap">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(ev) => {
                                      const next = new Set(selectedDailyIds);
                                      if (ev.target.checked) next.add(e.id);
                                      else next.delete(e.id);
                                      setSelectedDailyIds(next);
                                    }}
                                    className="w-4 h-4 text-[#EF7D25] rounded focus:ring-[#EF7D25] cursor-pointer"
                                  />
                                  <span>{e.name}</span>
                                  {evalRes.badges.map((b, idx) => (
                                    <button
                                      key={idx}
                                      type="button"
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        ev.preventDefault();
                                        openBadgeModal(e, b);
                                      }}
                                      className={`text-[11px] px-2 py-0.5 rounded-md border transition-all cursor-pointer hover:opacity-80 ${b.color}`}
                                      title={`${b.category}: ${b.curValue}`}
                                    >
                                      {b.text}
                                    </button>
                                  ))}
                                </div>
                                <span className="text-xs font-semibold text-slate-500 shrink-0">일용직</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 하단 고정 가져오기 버튼 */}
                    <div className="pt-4 border-t border-slate-100">
                      {attTargetTab === "fulltime" && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={importSelectedFulltime}
                            disabled={selectedFulltimeIds.size === 0}
                            className="flex-1 bg-white text-[#EF7D25] border-2 border-[#EF7D25] hover:bg-orange-50 text-sm font-extrabold py-3.5 rounded-xl shadow-sm disabled:opacity-40 transition-all cursor-pointer flex items-center justify-center gap-1"
                          >
                            선택 가져오기
                          </button>
                          <button
                            type="button"
                            onClick={importAllFulltime}
                            className="flex-1 bg-[#EF7D25] hover:bg-[#d96b1b] text-white text-sm font-extrabold py-3.5 rounded-xl shadow-md flex items-center justify-center gap-1 transition-all cursor-pointer"
                          >
                            정직원 전체가져오기
                          </button>
                        </div>
                      )}
                      {attTargetTab === "parttime" && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={importSelectedParttime}
                            disabled={selectedParttimeIds.size === 0}
                            className="flex-1 bg-white text-[#EF7D25] border-2 border-[#EF7D25] hover:bg-orange-50 text-sm font-extrabold py-3.5 rounded-xl shadow-sm disabled:opacity-40 transition-all cursor-pointer flex items-center justify-center gap-1"
                          >
                            선택 가져오기
                          </button>
                          <button
                            type="button"
                            onClick={importAllParttime}
                            className="flex-1 bg-[#EF7D25] hover:bg-[#d96b1b] text-white text-sm font-extrabold py-3.5 rounded-xl shadow-md flex items-center justify-center gap-1 transition-all cursor-pointer"
                          >
                            알바 전체가져오기
                          </button>
                        </div>
                      )}
                      {attTargetTab === "daily" && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={importSelectedDaily}
                            disabled={selectedDailyIds.size === 0}
                            className="flex-1 bg-white text-[#EF7D25] border-2 border-[#EF7D25] hover:bg-orange-50 text-sm font-extrabold py-3.5 rounded-xl shadow-sm disabled:opacity-40 transition-all cursor-pointer flex items-center justify-center gap-1"
                          >
                            선택 가져오기
                          </button>
                          <button
                            type="button"
                            onClick={importAllDaily}
                            className="flex-1 bg-[#EF7D25] hover:bg-[#d96b1b] text-white text-sm font-extrabold py-3.5 rounded-xl shadow-md flex items-center justify-center gap-1 transition-all cursor-pointer"
                          >
                            일용직 전체가져오기
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 👉 우측 중앙 작업창: 행(Row) 단위 일괄 입력 그리드 */}
                  <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200/90 p-7 shadow-sm flex flex-col justify-between min-h-[580px]">
                    <div>
                      <div className="flex flex-wrap items-center justify-between pb-4 mb-6 border-b border-slate-100 gap-3">
                        <div className="flex items-center gap-2.5">
                          <Clock className="w-6 h-6 text-[#EF7D25]" />
                          <h2 className="text-xl font-black text-slate-900">
                            근태 일괄 작성 작업창
                          </h2>
                          <span className="text-xs bg-orange-100 text-[#EF7D25] font-extrabold px-3 py-1 rounded-full border border-orange-200">
                            {attGlobalDate} 대상 ({loadedRows.length}명 로드됨)
                          </span>
                        </div>

                        {loadedRows.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              if (!checkEditPermission()) return;
                              setLoadedRows([]);
                            }}
                            className="text-xs text-rose-600 hover:text-rose-800 font-bold bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                          >
                            작업창 전체 비우기
                          </button>
                        )}
                      </div>

                      {loadedRows.length === 0 ? (
                        <div className="text-center py-20 border-2 border-dashed border-slate-200 rounded-2xl space-y-3 bg-slate-50/50">
                          <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center mx-auto text-slate-400">
                            <Users className="w-6 h-6" />
                          </div>
                          <div className="text-base font-bold text-slate-700">
                            작업창이 비어있습니다.
                          </div>
                          <p className="text-xs text-slate-500 max-w-sm mx-auto">
                            좌측에서 <strong>정직원, 아르바이트, 일용직</strong>을 선택한 후 <strong>[가져오기]</strong> 버튼을 누르면 이곳에 행(Row)으로 불러와 일괄 작성할 수 있습니다.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4 max-h-[520px] overflow-y-auto pr-1">
                          {loadedRows.map((row) => {
                            const isFulltime = row.employmentType === "정직원";
                            const isParttime = row.employmentType === "아르바이트";
                            const isDaily = row.employmentType === "일용직";
                            const computedHrs = computeRowHours(row);

                            // 해당 사원의 주간 누적 근로시간 현황
                            const currentWeeklyHrs = weeklyHoursByEmployee[row.empId] || 0;
                            const projectedHrs = currentWeeklyHrs + computedHrs;
                            const isPartTimeOver15h = isParttime && projectedHrs >= 15;

                            return (
                              <div
                                key={row.rowId}
                                className={`border-2 rounded-xl p-4 transition-all shadow-xs space-y-3 relative ${
                                  isFulltime
                                    ? "bg-slate-50/80 border-slate-300"
                                    : isParttime
                                    ? "bg-orange-50/40 border-orange-200"
                                    : "bg-emerald-50/40 border-emerald-200"
                                }`}
                              >
                                {/* 행 헤더: 이름 / 부서·직책 / 날짜 / [X] 제거 */}
                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-2.5">
                                  <div className="flex items-center gap-2">
                                    <span className="font-black text-lg text-slate-900">{row.name}</span>
                                    <span className={`text-xs font-extrabold px-2.5 py-0.5 rounded-md border ${
                                      isFulltime
                                        ? "bg-slate-200 text-slate-800 border-slate-300"
                                        : isParttime
                                        ? "bg-orange-100 text-[#EF7D25] border-orange-300"
                                        : "bg-emerald-100 text-emerald-800 border-emerald-300"
                                    }`}>
                                      {row.employmentType}
                                    </span>
                                    
                                    {/* 👔 정직원: 이름 / 부서·직책 / 날짜 표시 */}
                                    {isFulltime && (
                                      <span className="text-xs font-bold text-slate-600 bg-white border border-slate-200 px-2.5 py-0.5 rounded-md">
                                        부서/직책: {row.deptPosition}
                                      </span>
                                    )}

                                    <span className="text-xs text-slate-500 font-medium">
                                      📅 날짜: <strong>{row.date}</strong>
                                    </span>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => removeLoadedRow(row.rowId)}
                                    className="text-xs text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-1.5 rounded-lg border border-transparent hover:border-rose-200 transition-all cursor-pointer flex items-center gap-1 font-bold"
                                    title="작업창에서 해당 행 제외"
                                  >
                                    <X className="w-4 h-4" /> 제외
                                  </button>
                                </div>

                                {/* 행 메인 바디: 근태구분(정직원 전용) 및 시간 입력 */}
                                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                                  {/* 근태 구분 (정직원 전용) */}
                                  {isFulltime && (
                                    <div className="md:col-span-4">
                                      <label className="block text-xs font-bold text-slate-600 mb-1">근태 구분</label>
                                      <select
                                        value={row.type}
                                        onChange={(e) => updateRow(row.rowId, "type", e.target.value)}
                                        className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#EF7D25] shadow-xs cursor-pointer"
                                      >
                                        {ATTEND_TYPES.map((t) => (
                                          <option key={t} value={t}>{t}</option>
                                        ))}
                                      </select>
                                    </div>
                                  )}

                                  {/* 시간 입력 컨트롤 (글로벌 토글 모드 반영 - 정직원은 8컬럼, 아르바이트/일용직은 12컬럼 전체 사용) */}
                                  <div className={`${isFulltime ? "md:col-span-8" : "md:col-span-12"} space-y-2`}>
                                    <label className="block text-xs font-bold text-slate-600">
                                      근무시간 입력 ({row.mode === "start-end" ? "출퇴근 시간" : row.mode === "start-hours" ? "시작+총시간" : "출근체크 모드"})
                                    </label>

                                    <div className="flex flex-wrap items-center gap-3">
                                      {row.mode === "start-end" && (
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="time"
                                            value={row.start}
                                            onChange={(e) => updateRow(row.rowId, "start", e.target.value)}
                                            className="bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-sm font-bold text-slate-900 shadow-xs focus:ring-2 focus:ring-[#EF7D25]"
                                          />
                                          <span className="text-slate-400 font-bold">~</span>
                                          <input
                                            type="time"
                                            value={row.end}
                                            onChange={(e) => updateRow(row.rowId, "end", e.target.value)}
                                            className="bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-sm font-bold text-slate-900 shadow-xs focus:ring-2 focus:ring-[#EF7D25]"
                                          />
                                        </div>
                                      )}

                                      {row.mode === "start-hours" && (
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="time"
                                            value={row.start}
                                            onChange={(e) => updateRow(row.rowId, "start", e.target.value)}
                                            className="bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-sm font-bold text-slate-900 shadow-xs"
                                          />
                                          <input
                                            type="number"
                                            placeholder="총 시간(h)"
                                            value={row.hours}
                                            onChange={(e) => updateRow(row.rowId, "hours", e.target.value)}
                                            className="w-24 bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-sm font-bold text-slate-900 shadow-xs"
                                          />
                                          <span className="text-xs font-bold text-slate-600">시간</span>
                                        </div>
                                      )}

                                      {row.mode === "start-only" && (
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="time"
                                            value={row.start}
                                            onChange={(e) => updateRow(row.rowId, "start", e.target.value)}
                                            className="bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-sm font-bold text-slate-900 shadow-xs"
                                          />
                                          <input
                                            type="number"
                                            placeholder="총 시간(h)"
                                            value={row.hours !== undefined ? row.hours : 10}
                                            onChange={(e) => updateRow(row.rowId, "hours", e.target.value)}
                                            className="w-24 bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-sm font-bold text-slate-900 shadow-xs"
                                          />
                                          <span className="text-xs font-bold text-slate-600">시간</span>
                                        </div>
                                      )}

                                      {/* 🐥 아르바이트: 휴식(휴게)시간 차감 입력 및 실 근무시간 계산 */}
                                      {isParttime && (
                                        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200">
                                          <span className="text-xs font-bold text-slate-600">휴식시간:</span>
                                          <select
                                            value={row.breakMinutes ?? 60}
                                            onChange={(e) => updateRow(row.rowId, "breakMinutes", Number(e.target.value))}
                                            className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-extrabold text-slate-900 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#EF7D25]"
                                          >
                                            <option value={0}>0분</option>
                                            <option value={30}>30분</option>
                                            <option value={60}>60분</option>
                                            <option value={90}>90분</option>
                                            <option value={120}>120분</option>
                                          </select>
                                        </div>
                                      )}

                                      {/* 계산된 실 인정 근로시간 */}
                                      <div className="text-sm font-black text-[#EF7D25] bg-orange-50 border border-orange-200 px-3.5 py-1.5 rounded-xl ml-auto">
                                        실 근로: {computedHrs}시간
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* ⚠️ 아르바이트 주 15시간 초과 위험 알림 바 */}
                                {isPartTimeOver15h && (
                                  <div className="text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 p-2.5 rounded-lg flex items-center gap-2 mt-2">
                                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                                    <span>
                                      누적 주간 근로시간 <strong>{projectedHrs}시간</strong> 도달! (주휴수당 지급 조건 충족 및 퇴직금 발생 가능 알림)
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 하단 고정: 전체 근태 일괄 저장 버튼 */}
                    <div className="pt-6 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={saveAllLoadedRows}
                        className="w-full bg-[#EF7D25] hover:bg-[#d96b1b] text-white text-lg font-black py-4 rounded-xl shadow-lg flex items-center justify-center gap-2.5 transition-all cursor-pointer"
                      >
                        <Save className="w-5 h-5" />
                        {loadedRows.length}명 저장하기
                      </button>
                    </div>
                  </div>
                </div>

                {/* 3. 하단 현황: 해당 매장 최근 저장된 근태 기록 리스트 */}
                <div className="bg-white rounded-2xl border border-slate-200/90 p-7 shadow-sm">
                  <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    "{currentStoreCode}" 최근 저장된 근태 기록
                  </h3>
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {currentStoreAttendanceList.length === 0 && <div className="text-sm text-slate-500">근태 기록이 없습니다.</div>}
                    {currentStoreAttendanceList.slice().reverse().map((a) => {
                      const emp = employees.find((e) => e.id === a.employeeId);
                      return (
                        <div key={a.id} className="text-sm flex justify-between items-center border-b border-slate-100 py-2">
                          <span className="font-semibold text-slate-800">
                            {emp?.name || "사원"} · {a.date} · <span className="text-slate-600">{a.type}</span>
                            {a.breakMinutes > 0 && <span className="text-xs text-slate-400 ml-2">(휴게 {a.breakMinutes}분 차감됨)</span>}
                          </span>
                          <span className="font-bold text-[#EF7D25] bg-orange-50 border border-orange-200 px-2.5 py-1 rounded-lg text-xs">{a.totalHours || a.hours}시간</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
    );
  };

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
            {(waitingAccounting.length + pendingResignations.length + suspectedResignations.length) > 0 && (
              <span className="ml-1 bg-[#EF7D25] text-white text-xs font-extrabold rounded-full px-2 py-0.5 shadow-xs">
                {waitingAccounting.length + pendingResignations.length + suspectedResignations.length}
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
                onClick={() => setStoreTab("attendance")}
                className={`px-5 py-2.5 rounded-xl text-base font-bold transition-all shadow-xs cursor-pointer ${
                  storeTab === "attendance"
                    ? "bg-[#EF7D25] text-white shadow-md"
                    : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                근태입력
              </button>
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
                    <div className="text-sm font-semibold text-slate-700 mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span>첨부서류 (클릭 후 사진 첨부)</span>
                      <span className="text-rose-500 font-bold text-[11px] sm:text-xs bg-rose-50 px-2 py-0.5 rounded border border-rose-200">※ 등록 후 30일 경과 시 자동 파기</span>
                    </div>
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

            {/* ---------------- 🗓️ 새로 개편된 그리드형 일괄 매장 근태 입력 ---------------- */}
            {storeTab === "attendance" && renderAttendanceTab()}
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
                <UserPlus className="w-4 h-4" />
                <span>사원등록/퇴사 관리</span>
                {(waitingAccounting.length + pendingResignations.length + suspectedResignations.length) > 0 && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-black ${
                    accountingSubtab === "confirm" ? "bg-white text-[#EF7D25]" : "bg-[#EF7D25] text-white"
                  }`}>
                    {waitingAccounting.length + pendingResignations.length + suspectedResignations.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setAccountingSubtab("attendance")}
                className={`px-5 py-2.5 rounded-xl text-base font-bold transition-all shadow-xs cursor-pointer flex items-center gap-2 ${
                  accountingSubtab === "attendance"
                    ? "bg-[#EF7D25] text-white shadow-md"
                    : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Calendar className="w-4 h-4" />
                <span>근태 관리</span>
              </button>

              <button
                onClick={() => setAccountingSubtab("employees")}
                className={`px-5 py-2.5 rounded-xl text-base font-bold transition-all shadow-xs cursor-pointer flex items-center gap-2 ${
                  accountingSubtab === "employees"
                    ? "bg-[#EF7D25] text-white shadow-md"
                    : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Users className="w-4 h-4" />
                <span>직원 관리</span>
              </button>

              <button
                onClick={() => setAccountingSubtab("holidays")}
                className={`px-5 py-2.5 rounded-xl text-base font-bold transition-all shadow-xs cursor-pointer flex items-center gap-2 ${
                  accountingSubtab === "holidays"
                    ? "bg-[#EF7D25] text-white shadow-md"
                    : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Calendar className="w-4 h-4" />
                <span>연차/휴무일 관리</span>
              </button>

              <button
                onClick={() => setAccountingSubtab("labor")}
                className={`px-5 py-2.5 rounded-xl text-base font-bold transition-all shadow-xs cursor-pointer flex items-center gap-2 ${
                  accountingSubtab === "labor"
                    ? "bg-[#EF7D25] text-white shadow-md"
                    : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Sliders className="w-4 h-4" />
                <span>아르바이트 수당 관리</span>
                {actionableLaborEmps.length > 0 && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-black ${
                    accountingSubtab === "labor" ? "bg-white text-[#EF7D25]" : "bg-[#EF7D25] text-white"
                  }`}>
                    {actionableLaborEmps.length}
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
                {/* 🏛️ 신규 입사 사원 회계팀 확인 대기 목록 (상단) */}
                <div className="bg-white rounded-2xl border border-slate-200/90 p-8 shadow-sm">
                  <div className="flex items-center gap-2 text-xl font-bold text-slate-900 mb-2">
                    <Landmark className="w-6 h-6 text-[#EF7D25]" />
                    <h2>회계팀 확인 대기 목록 (게이트 1단계)</h2>
                  </div>
                  <p className="text-sm text-slate-500 mb-6">
                    🔍 <strong>회계 전용 확인</strong>: 첨부된 사진(주민등록증, 통장사본) 확인 후 [회계팀 승인]을 클릭하세요. 승인 시 계좌번호를 제외한 정보가 인사팀으로 전송됩니다.
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
                            <div className="text-sm font-medium text-slate-600">
                              연락처: {e.phone}
                            </div>
                            
                            <div className="flex flex-wrap gap-3 pt-2">
                              <DocChip ok={e.idCard} label="주민등록증" employeeName={e.name} />
                              <DocChip ok={e.bankbook} label="통장사본" employeeName={e.name} />
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              if (!e.idCard || !e.bankbook) {
                                alert("필요 서류(주민등록증, 통장사본)가 모두 필요합니다.");
                                return;
                              }
                              confirmAccounting(e.id);
                            }}
                            className={`flex items-center gap-1.5 text-white text-sm font-bold px-5 py-3.5 rounded-xl shadow-md transition-all ${
                              (e.idCard && e.bankbook)
                                ? "bg-[#EF7D25] hover:bg-[#d96b1b] cursor-pointer"
                                : "bg-slate-300 cursor-not-allowed"
                            }`}
                          >
                            <Check className="w-4 h-4" /> 회계 승인 (대조 완료 ➔ 인사팀 전달)
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

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

                {/* 🚨 2주 이상 무단 결근 (퇴직 의심자) 알림 배너 (하단) */}
                {suspectedResignations.length > 0 && (
                  <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-6 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 text-lg font-bold text-amber-800 border-b border-amber-200 pb-3">
                      <AlertTriangle className="w-5.5 h-5.5 text-amber-600" />
                      <h2>🚨 2주 이상 장기 미출근 (퇴직 의심) 알림 ({suspectedResignations.length}명)</h2>
                    </div>
                    <p className="text-xs text-amber-700">마지막 출근일 또는 입사일로부터 14일 이상 출근 기록이 없는 정직원/아르바이트 명단입니다.</p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {suspectedResignations.map((e) => (
                        <div key={e.id} className="relative bg-white border border-amber-300 rounded-xl p-4 flex flex-col justify-between gap-4 shadow-xs">
                          {/* 닫기(알림 무시) 버튼 */}
                          <button
                            onClick={() => setDismissedSuspectedAlerts([...dismissedSuspectedAlerts, e.id])}
                            className="absolute top-2 right-2 p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 rounded-full transition-colors cursor-pointer"
                            title="처리 완료 혹은 무시 (알림 닫기)"
                          >
                            <X className="w-4 h-4" />
                          </button>

                          <div className="space-y-1 mt-1 pr-6">
                            <div className="text-base font-bold text-slate-900 leading-tight">
                              <span className="text-amber-700 mr-2">[{e.storeCode}]</span>
                              {e.name}
                              <span className="text-xs font-semibold px-2 py-0.5 bg-slate-200 text-slate-700 rounded-md ml-2 inline-block mt-1 sm:mt-0">{e.employmentType}</span>
                            </div>
                            <div className="text-sm text-slate-600 font-medium pt-1">
                              입사일: <strong className="text-slate-900">{e.hireDate}</strong>
                            </div>
                          </div>
                          
                          <button
                            onClick={() => setSelectedEmpProfile(e)}
                            className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold text-sm px-4 py-2.5 rounded-xl shadow-xs transition-all cursor-pointer flex items-center justify-center gap-2"
                          >
                            <UserCheck className="w-4 h-4" />
                            프로필 열람
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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

            {/* 서브탭 4: 🏢 회계팀 전체 근태 관리 */}
            {accountingSubtab === "attendance" && (
              <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-200">
                <div className="bg-white rounded-2xl border border-slate-200/90 p-7 shadow-sm">
                  <div className="flex items-center gap-4 mb-6">
                    <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                      <Store className="w-6 h-6 text-[#EF7D25]" />
                      매장 선택
                    </h2>
                    <select
                      value={currentStoreCode}
                      onChange={(e) => setCurrentStoreCode(e.target.value)}
                      className="bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-base font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#EF7D25] shadow-xs cursor-pointer min-w-[200px]"
                    >
                      {storeList.map(s => (
                        <option key={s.code} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                    <span className="text-sm text-slate-500 font-semibold ml-2">
                      선택한 매장의 근태 데이터를 열람/수정합니다. (회계 권한)
                    </span>
                  </div>
                  
                  {renderAttendanceTab()}
                </div>
              </div>
            )}

            {/* 서브탭 5: 🏝️ 연차/휴무일 관리 */}
            {accountingSubtab === "holidays" && (
              <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-200">
                {/* 리스크 알림 카드 3개 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div className="bg-white border-2 border-rose-200 rounded-2xl p-5 shadow-xs flex items-center justify-between">
                    <div>
                      <div className="text-rose-600 font-bold text-sm mb-1 flex items-center gap-1.5"><AlertCircle className="w-4 h-4"/> 연차 사용 촉진 대상</div>
                      <div className="text-2xl font-black text-slate-900">{leaveStats.promoteCount}명</div>
                      <div className="text-xs text-slate-500 mt-1">소멸 6개월 전, 사용 촉구(서면) 필요</div>
                    </div>
                  </div>
                  <div className="bg-white border border-amber-200 rounded-2xl p-5 shadow-xs flex items-center justify-between">
                    <div>
                      <div className="text-amber-600 font-bold text-sm mb-1 flex items-center gap-1.5"><DollarSign className="w-4 h-4"/> 연차 수당 정산 필요</div>
                      <div className="text-2xl font-black text-slate-900">{leaveStats.settlementCount}명</div>
                      <div className="text-xs text-slate-500 mt-1">퇴사자 및 미사용 소멸 연차 정산</div>
                    </div>
                  </div>
                  <div className="bg-white border border-purple-200 rounded-2xl p-5 shadow-xs flex items-center justify-between">
                    <div>
                      <div className="text-purple-600 font-bold text-sm mb-1 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4"/> 마이너스 연차 (초과)</div>
                      <div className="text-2xl font-black text-slate-900">{leaveStats.minusCount}명</div>
                      <div className="text-xs text-slate-500 mt-1">부여량보다 많이 사용, 급여 공제 필요</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* 좌측: 연차 관리 테이블 */}
                  <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden flex flex-col">
                    <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                        <Users className="w-5 h-5 text-[#EF7D25]" /> 정직원 연차 관리 대장
                      </h3>
                      <span className="text-xs font-semibold bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-md border border-emerald-200">
                        입사일 기준 근속 자동계산 중
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 text-xs">
                          <tr>
                            <th className="px-4 py-3">이름/소속</th>
                            <th className="px-4 py-3">입사일</th>
                            <th className="px-4 py-3">근속 (만)</th>
                            <th className="px-4 py-3 text-center bg-blue-50/50">총 부여</th>
                            <th className="px-4 py-3 text-center bg-rose-50/50">사용</th>
                            <th className="px-4 py-3 text-center bg-emerald-50/50">잔여</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {leaveStats.list.map(e => (
                            <tr key={e.id} className={`hover:bg-slate-50/50 ${e.resignDate ? "opacity-50" : ""}`}>
                              <td className="px-4 py-3">
                                <div className="font-bold text-slate-900">{e.name} {e.isPromote && <span className="ml-1 inline-flex w-2 h-2 rounded-full bg-rose-500 animate-pulse" title="촉진 대상"></span>}</div>
                                <div className="text-xs text-slate-500">{e.storeCode}</div>
                              </td>
                              <td className="px-4 py-3 text-slate-600">{e.hireDate || "-"}</td>
                              <td className="px-4 py-3">
                                <span className="font-bold text-[#EF7D25]">{e.yearsOfService}년차</span>
                                <div className="text-[10px] text-slate-400">({e.monthsOfService}개월)</div>
                              </td>
                              <td className="px-4 py-3 text-center bg-blue-50/10">
                                <input
                                  type="number"
                                  min="0"
                                  className="w-16 text-center border border-slate-200 rounded p-1 text-sm font-bold bg-white focus:ring-1 focus:ring-blue-400"
                                  value={e.total}
                                  onChange={(evt) => {
                                    const val = parseInt(evt.target.value) || 0;
                                    setLeaveBalances(prev => ({ ...prev, [e.id]: { ...(prev[e.id]||{used:0}), total: val }}));
                                  }}
                                />
                              </td>
                              <td className="px-4 py-3 text-center bg-rose-50/10">
                                <input
                                  type="number"
                                  min="0"
                                  className="w-16 text-center border border-slate-200 rounded p-1 text-sm font-bold bg-white focus:ring-1 focus:ring-rose-400"
                                  value={e.used}
                                  onChange={(evt) => {
                                    const val = parseInt(evt.target.value) || 0;
                                    setLeaveBalances(prev => ({ ...prev, [e.id]: { ...(prev[e.id]||{total:e.total}), used: val }}));
                                  }}
                                />
                              </td>
                              <td className="px-4 py-3 text-center bg-emerald-50/10">
                                <span className={`font-black text-lg ${e.remain < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                  {e.remain}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 우측: 휴무일 관리 및 카운터 */}
                  <div className="space-y-6">
                    {/* 공휴일 캘린더/목록 */}
                    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 space-y-4">
                      <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                        <h3 className="font-bold text-slate-900 flex items-center gap-2">
                          <Calendar className="w-5 h-5 text-[#EF7D25]" /> 본사 지정 공휴일
                        </h3>
                        <button
                          onClick={() => setIsHolidayModalOpen(true)}
                          className="text-xs bg-orange-50 text-[#EF7D25] hover:bg-orange-100 px-2 py-1 rounded font-bold border border-orange-200 transition-colors cursor-pointer"
                        >
                          + 날짜 추가
                        </button>
                      </div>
                      <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                        {companyHolidays.map(h => (
                          <div key={h.id} className="flex justify-between items-center p-2 rounded-lg bg-slate-50 border border-slate-100 text-sm hover:border-slate-300 transition-colors group">
                            <span className="font-bold text-slate-700">{h.date}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 text-xs">{h.name}</span>
                              <button
                                onClick={() => setCompanyHolidays(companyHolidays.filter(item => item.id !== h.id))}
                                className="text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer p-0.5"
                                title="삭제"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 월간 휴일근무자 (자동집계) */}
                    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 space-y-4">
                      <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                        <h3 className="font-bold text-slate-900 flex items-center gap-2">
                          <CheckCircle2 className="w-5 h-5 text-amber-500" /> 이번 달 공휴일 근무자
                        </h3>
                        <span className="text-xs text-slate-400">자동 카운트</span>
                      </div>
                      <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1">
                        {holidayWorkStats.map(holiday => (
                          <div key={holiday.date} className="border border-amber-200 rounded-xl overflow-hidden bg-white shadow-xs">
                            <div className="bg-amber-50/80 px-3 py-2 border-b border-amber-100 flex justify-between items-center">
                              <span className="font-bold text-amber-900">{holiday.date}</span>
                              <span className="text-xs font-bold text-amber-700 bg-amber-200/50 px-2 py-0.5 rounded-full">{holiday.name}</span>
                            </div>
                            <div className="divide-y divide-slate-100">
                              {holiday.stores.map(store => {
                                const total = store.fulltime + store.parttime + store.daily;
                                return (
                                  <div key={store.storeName} className="p-3 flex justify-between items-center hover:bg-slate-50 transition-colors">
                                    <div className="font-bold text-slate-800 text-sm">{store.storeName}</div>
                                    <div className="flex gap-2 text-xs">
                                      {store.fulltime > 0 && (
                                        <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded font-bold">정직원 {store.fulltime}명</span>
                                      )}
                                      {store.parttime > 0 && (
                                        <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded font-bold">아르바이트 {store.parttime}명</span>
                                      )}
                                      {store.daily > 0 && (
                                        <span className="bg-slate-200 text-slate-700 px-2 py-1 rounded font-bold">일용직 {store.daily}명</span>
                                      )}
                                      <span className="bg-slate-800 text-white px-2 py-1 rounded font-black ml-1">총 {total}명</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                        {holidayWorkStats.length === 0 && (
                          <div className="text-center text-slate-400 text-xs py-6 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                            이번 달 등록된 공휴일 근무 기록이 없습니다.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 서브탭 3: ⚖️ 근로조건 관리 (아르바이트 항목별 이슈현황 보드판 + 수치적 Config 관리) */}
            {accountingSubtab === "labor" && (
              <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-200">
                {/* 🚨 퇴직금 확정 사원 발생 알림 배너 (회계팀 연동) */}
                {confirmedSeveranceEmps.length > 0 && (
                  <div className="bg-gradient-to-r from-orange-500 to-amber-600 rounded-2xl p-6 text-white shadow-lg space-y-3">
                    <div className="flex items-center justify-between border-b border-white/20 pb-3">
                      <div className="flex items-center gap-2 text-lg font-black">
                        <AlertTriangle className="w-6 h-6 text-yellow-300 animate-bounce" />
                        <h2>🚨 아르바이트 퇴직금 발생 확정 알림 ({confirmedSeveranceEmps.length}건) — 회계팀 정산 처리 필요</h2>
                      </div>
                      <span className="text-xs bg-white/20 px-3 py-1 rounded-full font-bold">
                        회계팀 자동 수신 알림
                      </span>
                    </div>
                    <p className="text-sm opacity-90 font-medium">
                      입사 후 만 1년(근속 1년 + 주 15시간 이상)에 도달한 사원입니다. 정산 처리 후 알림 상태를 확인하세요.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                      {confirmedSeveranceEmps.map(({ emp, evalRes }) => (
                        <div key={emp.id} className="relative bg-white/10 backdrop-blur-xs border border-white/20 rounded-xl p-3 flex justify-between items-center text-sm pr-9">
                          <button
                            onClick={() => setDismissedSeveranceAlerts([...dismissedSeveranceAlerts, emp.id])}
                            className="absolute top-1 right-1 p-1 text-white/50 hover:bg-white/20 hover:text-white rounded-full transition-colors cursor-pointer"
                            title="처리 완료 혹은 무시 (알림 닫기)"
                          >
                            <X className="w-4 h-4" />
                          </button>
                          <div>
                            <span className="font-bold">{emp.name}</span>
                            <span className="text-xs ml-2 opacity-80">({emp.storeCode})</span>
                            <div className="text-xs text-yellow-200 mt-0.5">{evalRes.severanceBadge?.curValue}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => openBadgeModal(emp, evalRes.severanceBadge)}
                            className="text-xs bg-white text-orange-600 hover:bg-orange-50 font-bold px-3 py-1.5 rounded-lg shadow-xs cursor-pointer"
                          >
                            정산 안내
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 1. 요약 통계 카드 3개 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-2">
                    <div className="flex justify-between items-center text-slate-500 text-xs font-bold">
                      <span>💡 주휴수당 이슈 현황</span>
                      <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md border border-blue-200">주 15시간 기준</span>
                    </div>
                    <div className="text-2xl font-black text-slate-900 flex items-baseline gap-2">
                      <span>
                        {allLaborEvaluations.filter((x) => x.evalRes.weeklyBadge).length}명
                      </span>
                      <span className="text-xs text-amber-600 font-semibold">
                        (2단계 이상: {allLaborEvaluations.filter((x) => x.evalRes.weeklyBadge?.levelNum >= 2).length}명)
                      </span>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-2">
                    <div className="flex justify-between items-center text-slate-500 text-xs font-bold">
                      <span>🛡️ 4대보험 이슈 현황</span>
                      <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded-md border border-purple-200">월 60시간/8일 기준</span>
                    </div>
                    <div className="text-2xl font-black text-slate-900 flex items-baseline gap-2">
                      <span>
                        {allLaborEvaluations.filter((x) => x.evalRes.insuranceBadge).length}명
                      </span>
                      <span className="text-xs text-amber-600 font-semibold">
                        (2단계 이상: {allLaborEvaluations.filter((x) => x.evalRes.insuranceBadge?.levelNum >= 2).length}명)
                      </span>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-2">
                    <div className="flex justify-between items-center text-slate-500 text-xs font-bold">
                      <span>💰 퇴직금 이슈 현황</span>
                      <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md border border-emerald-200">입사 만 1년 기준</span>
                    </div>
                    <div className="text-2xl font-black text-slate-900 flex items-baseline gap-2">
                      <span>
                        {allLaborEvaluations.filter((x) => x.evalRes.severanceBadge).length}명
                      </span>
                      <span className="text-xs text-amber-600 font-semibold">
                        (2단계 이상: {allLaborEvaluations.filter((x) => x.evalRes.severanceBadge?.levelNum >= 2).length}명)
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. 아르바이트/전사원 항목별 이슈현황 보드판 */}
                <div className="bg-white rounded-2xl border border-slate-200/90 p-7 shadow-sm space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
                    <div>
                      <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                        <Sliders className="w-5 h-5 text-[#EF7D25]" />
                        아르바이트 항목별 이슈현황 보드판
                      </h2>
                      <p className="text-xs text-slate-500 mt-1">
                        인원 불러오기 화면의 뱃지 데이터와 동일 소스로 실시간 연동되며 항목별/단계별 이슈 인원을 모니터링합니다.
                      </p>
                    </div>

                    {/* 해결 방안 제안 대상 (2단계 이상) 필터링 토글 */}
                    <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200">
                      <button
                        type="button"
                        onClick={() => setLaborBoardFilter("all")}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                          laborBoardFilter === "all"
                            ? "bg-white text-slate-900 shadow-xs"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        전체 보기
                      </button>
                      <button
                        type="button"
                        onClick={() => setLaborBoardFilter("actionable")}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                          laborBoardFilter === "actionable"
                            ? "bg-[#EF7D25] text-white shadow-xs"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        <span>⚡ 해결 방안 제안 대상 (2단계 이상만)</span>
                        <span className="ml-1 bg-white/20 text-white px-1.5 py-0.2 rounded-full text-[10px]">
                          {actionableLaborEmps.length}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* 3개 항목별 카테고리 그리드 리스트 */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* [카테고리 1: 주휴수당] */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                      <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                          <span>💡 주휴수당 이슈</span>
                        </h3>
                        <span className="text-xs text-slate-500 font-semibold">
                          {
                            allLaborEvaluations.filter((x) => {
                              if (!x.evalRes.weeklyBadge) return false;
                              if (laborBoardFilter === "actionable") return x.evalRes.weeklyBadge.levelNum >= 2;
                              return true;
                            }).length
                          }명
                        </span>
                      </div>

                      <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                        {allLaborEvaluations
                          .filter((x) => {
                            if (!x.evalRes.weeklyBadge) return false;
                            if (laborBoardFilter === "actionable") return x.evalRes.weeklyBadge.levelNum >= 2;
                            return true;
                          })
                          .map(({ emp, evalRes }) => {
                            const b = evalRes.weeklyBadge;
                            return (
                              <div key={emp.id} className="bg-white border border-slate-200 rounded-xl p-3 text-xs space-y-2 shadow-2xs hover:border-orange-300 transition-all">
                                <div className="flex justify-between items-center">
                                  <span className="font-bold text-slate-900 text-sm">{emp.name}</span>
                                  <button
                                    type="button"
                                    onClick={() => openBadgeModal(emp, b)}
                                    className={`px-2 py-0.5 rounded text-[11px] font-bold border cursor-pointer hover:opacity-80 ${b.color}`}
                                  >
                                    {b.text}
                                  </button>
                                </div>
                                <div className="text-slate-600 font-medium">수치: {b.curValue}</div>
                                {b.resolution && (
                                  <div className="bg-orange-50 text-orange-900 p-2 rounded-lg text-[11px] font-semibold border border-orange-200">
                                    "{b.resolution}"
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </div>

                    {/* [카테고리 2: 4대보험] */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                      <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                          <span>🛡️ 4대보험 이슈</span>
                        </h3>
                        <span className="text-xs text-slate-500 font-semibold">
                          {
                            allLaborEvaluations.filter((x) => {
                              if (!x.evalRes.insuranceBadge) return false;
                              if (laborBoardFilter === "actionable") return x.evalRes.insuranceBadge.levelNum >= 2;
                              return true;
                            }).length
                          }명
                        </span>
                      </div>

                      <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                        {allLaborEvaluations
                          .filter((x) => {
                            if (!x.evalRes.insuranceBadge) return false;
                            if (laborBoardFilter === "actionable") return x.evalRes.insuranceBadge.levelNum >= 2;
                            return true;
                          })
                          .map(({ emp, evalRes }) => {
                            const b = evalRes.insuranceBadge;
                            return (
                              <div key={emp.id} className="bg-white border border-slate-200 rounded-xl p-3 text-xs space-y-2 shadow-2xs hover:border-orange-300 transition-all">
                                <div className="flex justify-between items-center">
                                  <span className="font-bold text-slate-900 text-sm">{emp.name}</span>
                                  <button
                                    type="button"
                                    onClick={() => openBadgeModal(emp, b)}
                                    className={`px-2 py-0.5 rounded text-[11px] font-bold border cursor-pointer hover:opacity-80 ${b.color}`}
                                  >
                                    {b.text}
                                  </button>
                                </div>
                                <div className="text-slate-600 font-medium">{b.curValue}</div>
                                {b.resolution && (
                                  <div className="bg-orange-50 text-orange-900 p-2 rounded-lg text-[11px] font-semibold border border-orange-200">
                                    "{b.resolution}"
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </div>

                    {/* [카테고리 3: 퇴직금] */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                      <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                          <span>💰 퇴직금 이슈</span>
                        </h3>
                        <span className="text-xs text-slate-500 font-semibold">
                          {
                            allLaborEvaluations.filter((x) => {
                              if (!x.evalRes.severanceBadge) return false;
                              if (x.evalRes.severanceBadge.level === "confirmed") return false;
                              if (laborBoardFilter === "actionable") return x.evalRes.severanceBadge.levelNum >= 2;
                              return true;
                            }).length
                          }명
                        </span>
                      </div>

                      <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                        {allLaborEvaluations
                          .filter((x) => {
                            if (!x.evalRes.severanceBadge) return false;
                            if (x.evalRes.severanceBadge.level === "confirmed") return false;
                            if (laborBoardFilter === "actionable") return x.evalRes.severanceBadge.levelNum >= 2;
                            return true;
                          })
                          .map(({ emp, evalRes }) => {
                            const b = evalRes.severanceBadge;
                            return (
                              <div key={emp.id} className="bg-white border border-slate-200 rounded-xl p-3 text-xs space-y-2 shadow-2xs hover:border-orange-300 transition-all">
                                <div className="flex justify-between items-center">
                                  <span className="font-bold text-slate-900 text-sm">{emp.name}</span>
                                  <button
                                    type="button"
                                    onClick={() => openBadgeModal(emp, b)}
                                    className={`px-2 py-0.5 rounded text-[11px] font-bold border cursor-pointer hover:opacity-80 ${b.color}`}
                                  >
                                    {b.text}
                                  </button>
                                </div>
                                <div className="text-slate-600 font-medium">{b.curValue}</div>
                                {b.resolution && (
                                  <div className="bg-orange-50 text-orange-900 p-2 rounded-lg text-[11px] font-semibold border border-orange-200">
                                    "{b.resolution}"
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. ⚙️ 근로조건 수치 관리 (Config Editor UI) */}
                <div className="bg-white rounded-2xl border border-slate-200/90 p-7 shadow-sm space-y-6">
                  <div className="border-b border-slate-100 pb-4">
                    <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                      <Sliders className="w-5 h-5 text-[#EF7D25]" />
                      아르바이트 근로조건 수치 관리 (Config 설정)
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      시간·일수·개월수 임계 수치를 입력하고 <strong>[설정 저장]</strong>을 누르면 인원 불러오기 화면의 뱃지 및 보드판 데이터가 실시간으로 재계산됩니다.
                    </p>
                  </div>

                  <form
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      setLaborConfig(configForm);
                      try {
                        localStorage.setItem("payroll_labor_config", JSON.stringify(configForm));
                      } catch (e) {}
                      flash("근로조건 관리 수치가 성공적으로 저장되었습니다. 실시간 뱃지에 즉시 연동됩니다.");
                    }}
                    className="space-y-6"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* 1. 주휴수당 설정 카드리스트 */}
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
                        <h3 className="font-bold text-slate-900 text-sm border-b border-slate-200 pb-2">
                          💡 주휴수당 수치 설정 (주간 시간)
                        </h3>

                        <div className="space-y-3 text-xs">
                          <div>
                            <label className="block text-slate-600 font-semibold mb-1">기준 시간 (targetHours)</label>
                            <input
                              type="number"
                              step="0.5"
                              value={configForm.weeklyAllowance.targetHours}
                              onChange={(e) =>
                                setConfigForm({
                                  ...configForm,
                                  weeklyAllowance: { ...configForm.weeklyAllowance, targetHours: Number(e.target.value) },
                                })
                              }
                              className="w-full bg-white border border-slate-300 rounded-lg p-2 font-bold text-slate-900"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-slate-600 font-semibold mb-1">1단계 최소 (시간)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={configForm.weeklyAllowance.level1Min}
                                onChange={(e) =>
                                  setConfigForm({
                                    ...configForm,
                                    weeklyAllowance: { ...configForm.weeklyAllowance, level1Min: Number(e.target.value) },
                                  })
                                }
                                className="w-full bg-white border border-slate-300 rounded-lg p-2 font-semibold text-slate-800"
                              />
                            </div>
                            <div>
                              <label className="block text-slate-600 font-semibold mb-1">1단계 최대 (시간)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={configForm.weeklyAllowance.level1Max}
                                onChange={(e) =>
                                  setConfigForm({
                                    ...configForm,
                                    weeklyAllowance: { ...configForm.weeklyAllowance, level1Max: Number(e.target.value) },
                                  })
                                }
                                className="w-full bg-white border border-slate-300 rounded-lg p-2 font-semibold text-slate-800"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-slate-600 font-semibold mb-1">2단계 최소 (시간)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={configForm.weeklyAllowance.level2Min}
                                onChange={(e) =>
                                  setConfigForm({
                                    ...configForm,
                                    weeklyAllowance: { ...configForm.weeklyAllowance, level2Min: Number(e.target.value) },
                                  })
                                }
                                className="w-full bg-white border border-slate-300 rounded-lg p-2 font-semibold text-slate-800"
                              />
                            </div>
                            <div>
                              <label className="block text-slate-600 font-semibold mb-1">2단계 최대 (시간)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={configForm.weeklyAllowance.level2Max}
                                onChange={(e) =>
                                  setConfigForm({
                                    ...configForm,
                                    weeklyAllowance: { ...configForm.weeklyAllowance, level2Max: Number(e.target.value) },
                                  })
                                }
                                className="w-full bg-white border border-slate-300 rounded-lg p-2 font-semibold text-slate-800"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-slate-600 font-semibold mb-1">3단계 최소 (시간)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={configForm.weeklyAllowance.level3Min}
                                onChange={(e) =>
                                  setConfigForm({
                                    ...configForm,
                                    weeklyAllowance: { ...configForm.weeklyAllowance, level3Min: Number(e.target.value) },
                                  })
                                }
                                className="w-full bg-white border border-slate-300 rounded-lg p-2 font-semibold text-slate-800"
                              />
                            </div>
                            <div>
                              <label className="block text-slate-600 font-semibold mb-1">확정 임계시간</label>
                              <input
                                type="number"
                                step="0.1"
                                value={configForm.weeklyAllowance.confirmedMin}
                                onChange={(e) =>
                                  setConfigForm({
                                    ...configForm,
                                    weeklyAllowance: { ...configForm.weeklyAllowance, confirmedMin: Number(e.target.value) },
                                  })
                                }
                                className="w-full bg-white border border-slate-300 rounded-lg p-2 font-bold text-orange-600"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 2. 4대보험 설정 카드리스트 */}
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
                        <h3 className="font-bold text-slate-900 text-sm border-b border-slate-200 pb-2">
                          🛡️ 4대보험 수치 설정 (월 근로)
                        </h3>

                        <div className="space-y-3 text-xs">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-slate-600 font-semibold mb-1">기준 시간 (월)</label>
                              <input
                                type="number"
                                value={configForm.socialInsurance.targetHours}
                                onChange={(e) =>
                                  setConfigForm({
                                    ...configForm,
                                    socialInsurance: { ...configForm.socialInsurance, targetHours: Number(e.target.value) },
                                  })
                                }
                                className="w-full bg-white border border-slate-300 rounded-lg p-2 font-bold text-slate-900"
                              />
                            </div>
                            <div>
                              <label className="block text-slate-600 font-semibold mb-1">기준 근무일수</label>
                              <input
                                type="number"
                                value={configForm.socialInsurance.targetDays}
                                onChange={(e) =>
                                  setConfigForm({
                                    ...configForm,
                                    socialInsurance: { ...configForm.socialInsurance, targetDays: Number(e.target.value) },
                                  })
                                }
                                className="w-full bg-white border border-slate-300 rounded-lg p-2 font-bold text-slate-900"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-slate-600 font-semibold mb-1">1단계 (시간)</label>
                              <input
                                type="number"
                                value={configForm.socialInsurance.level1HoursMin}
                                onChange={(e) =>
                                  setConfigForm({
                                    ...configForm,
                                    socialInsurance: { ...configForm.socialInsurance, level1HoursMin: Number(e.target.value) },
                                  })
                                }
                                className="w-full bg-white border border-slate-300 rounded-lg p-2 font-semibold text-slate-800"
                              />
                            </div>
                            <div>
                              <label className="block text-slate-600 font-semibold mb-1">2단계 (시간)</label>
                              <input
                                type="number"
                                value={configForm.socialInsurance.level2HoursMin}
                                onChange={(e) =>
                                  setConfigForm({
                                    ...configForm,
                                    socialInsurance: { ...configForm.socialInsurance, level2HoursMin: Number(e.target.value) },
                                  })
                                }
                                className="w-full bg-white border border-slate-300 rounded-lg p-2 font-semibold text-slate-800"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-slate-600 font-semibold mb-1">3단계 (시간)</label>
                              <input
                                type="number"
                                value={configForm.socialInsurance.level3HoursMin}
                                onChange={(e) =>
                                  setConfigForm({
                                    ...configForm,
                                    socialInsurance: { ...configForm.socialInsurance, level3HoursMin: Number(e.target.value) },
                                  })
                                }
                                className="w-full bg-white border border-slate-300 rounded-lg p-2 font-semibold text-slate-800"
                              />
                            </div>
                            <div>
                              <label className="block text-slate-600 font-semibold mb-1">확정 시간</label>
                              <input
                                type="number"
                                value={configForm.socialInsurance.confirmedHoursMin}
                                onChange={(e) =>
                                  setConfigForm({
                                    ...configForm,
                                    socialInsurance: { ...configForm.socialInsurance, confirmedHoursMin: Number(e.target.value) },
                                  })
                                }
                                className="w-full bg-white border border-slate-300 rounded-lg p-2 font-bold text-orange-600"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-slate-600 font-semibold mb-1">월소득 기준 (만원)</label>
                            <input
                              type="number"
                              value={configForm.socialInsurance.confirmedIncomeMin}
                              onChange={(e) =>
                                setConfigForm({
                                  ...configForm,
                                  socialInsurance: { ...configForm.socialInsurance, confirmedIncomeMin: Number(e.target.value) },
                                })
                              }
                              className="w-full bg-white border border-slate-300 rounded-lg p-2 font-bold text-slate-900"
                            />
                          </div>
                        </div>
                      </div>

                      {/* 3. 퇴직금 설정 카드리스트 */}
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
                        <h3 className="font-bold text-slate-900 text-sm border-b border-slate-200 pb-2">
                          💰 퇴직금 수치 설정 (근속 개월수)
                        </h3>

                        <div className="space-y-3 text-xs">
                          <div>
                            <label className="block text-slate-600 font-semibold mb-1">기준 근속 (targetMonths)</label>
                            <input
                              type="number"
                              value={configForm.severance.targetMonths}
                              onChange={(e) =>
                                setConfigForm({
                                  ...configForm,
                                  severance: { ...configForm.severance, targetMonths: Number(e.target.value) },
                                })
                              }
                              className="w-full bg-white border border-slate-300 rounded-lg p-2 font-bold text-slate-900"
                            />
                          </div>

                          <div>
                            <label className="block text-slate-600 font-semibold mb-1">1단계 (6개월전 시점 개월수)</label>
                            <input
                              type="number"
                              value={configForm.severance.level1Months}
                              onChange={(e) =>
                                setConfigForm({
                                  ...configForm,
                                  severance: { ...configForm.severance, level1Months: Number(e.target.value) },
                                })
                              }
                              className="w-full bg-white border border-slate-300 rounded-lg p-2 font-semibold text-slate-800"
                            />
                          </div>

                          <div>
                            <label className="block text-slate-600 font-semibold mb-1">2단계 (4개월전 시점 개월수)</label>
                            <input
                              type="number"
                              value={configForm.severance.level2Months}
                              onChange={(e) =>
                                setConfigForm({
                                  ...configForm,
                                  severance: { ...configForm.severance, level2Months: Number(e.target.value) },
                                })
                              }
                              className="w-full bg-white border border-slate-300 rounded-lg p-2 font-semibold text-slate-800"
                            />
                          </div>

                          <div>
                            <label className="block text-slate-600 font-semibold mb-1">3단계 (2개월전 시점 개월수)</label>
                            <input
                              type="number"
                              value={configForm.severance.level3Months}
                              onChange={(e) =>
                                setConfigForm({
                                  ...configForm,
                                  severance: { ...configForm.severance, level3Months: Number(e.target.value) },
                                })
                              }
                              className="w-full bg-white border border-slate-300 rounded-lg p-2 font-semibold text-slate-800"
                            />
                          </div>

                          <div>
                            <label className="block text-slate-600 font-semibold mb-1">확정 개월수 (만 1년)</label>
                            <input
                              type="number"
                              value={configForm.severance.confirmedMonths}
                              onChange={(e) =>
                                setConfigForm({
                                  ...configForm,
                                  severance: { ...configForm.severance, confirmedMonths: Number(e.target.value) },
                                })
                              }
                              className="w-full bg-white border border-slate-300 rounded-lg p-2 font-bold text-orange-600"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end items-center gap-3 pt-4 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => {
                          setLaborConfig(DEFAULT_LABOR_CONFIG);
                          setConfigForm(DEFAULT_LABOR_CONFIG);
                          try {
                            localStorage.removeItem("payroll_labor_config");
                          } catch (e) {}
                          flash("근로조건 설정 수치가 기본값으로 복원되었습니다.");
                        }}
                        className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                      >
                        🔄 기본값으로 복원
                      </button>
                      <button
                        type="submit"
                        className="px-6 py-2.5 bg-[#EF7D25] hover:bg-[#d96b1b] text-white text-sm font-extrabold rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-2"
                      >
                        <Save className="w-4 h-4" />
                        <span>💾 근로조건 수치 설정 저장</span>
                      </button>
                    </div>
                  </form>
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
          <div className="space-y-8 animate-in fade-in duration-200">
            {/* 인사팀 상단 탭 버튼 */}
            {hrSubtab !== "dashboard" && (
              <div className="flex gap-3 mb-6">
                <button
                  onClick={() => setHrSubtab("confirm")}
                  className={`px-5 py-2.5 rounded-xl text-base font-bold transition-all shadow-xs cursor-pointer flex items-center gap-2 ${
                    hrSubtab === "confirm" ? "bg-[#EF7D25] text-white shadow-md" : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <Briefcase className="w-4 h-4" />
                  <span>서류 관리</span>
                </button>
                <button
                  onClick={() => setHrSubtab("employees")}
                  className={`px-5 py-2.5 rounded-xl text-base font-bold transition-all shadow-xs cursor-pointer flex items-center gap-2 ${
                    hrSubtab === "employees" ? "bg-[#EF7D25] text-white shadow-md" : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <Users className="w-4 h-4" />
                  <span>직원 관리</span>
                </button>
              </div>
            )}

            {/* 인사 서브탭 1: 서류 관리 (사원 승인 목록) */}
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
                            onClick={() => {
                              if (!e.healthCert || !e.contract) {
                                alert("필요 서류(보건증, 근로계약서)가 모두 필요합니다.");
                                return;
                              }
                              confirmHr(e.id);
                            }}
                            className={`flex items-center gap-1.5 text-white text-sm font-bold px-5 py-3.5 rounded-xl shadow-md transition-all ${
                              (e.healthCert && e.contract)
                                ? "bg-emerald-600 hover:bg-emerald-700 cursor-pointer"
                                : "bg-slate-300 cursor-not-allowed"
                            }`}
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
        {/* 서브탭 4: 👥 공통 직원 관리 (전사 통합 인명록) */}
        {((role === "accounting" && accountingSubtab === "employees") || (role === "hr" && hrSubtab === "employees")) && (
          <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-200">
            {/* 상단: 직원 관리 필터 및 검색 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
                <button onClick={() => setEmpManagementTab("working")} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${empManagementTab === "working" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>근무자</button>
                <button onClick={() => setEmpManagementTab("resigned")} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${empManagementTab === "resigned" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>퇴사자</button>
                <button onClick={() => setEmpManagementTab("search")} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${empManagementTab === "search" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>검색</button>
              </div>

              {empManagementTab === "search" && (
                <div className="relative w-full md:w-80">
                  <input type="text" placeholder="이름으로 사원 검색..." value={empSearchTerm} onChange={(e) => setEmpSearchTerm(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-[#EF7D25]" />
                </div>
              )}
            </div>

            {/* 하단: 리스트 렌더링 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider font-bold">
                    {(() => {
                      const handleSort = (key) => {
                        let direction = "asc";
                        if (empSortConfig.key === key && empSortConfig.direction === "asc") {
                          direction = "desc";
                        }
                        setEmpSortConfig({ key, direction });
                      };
                      const renderSortIcon = (key) => {
                        if (empSortConfig.key !== key) return null;
                        return empSortConfig.direction === "asc" ? " ↑" : " ↓";
                      };
                      return (
                        <>
                          <th className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("storeCode")}>매장명{renderSortIcon("storeCode")}</th>
                          <th className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("name")}>이름{renderSortIcon("name")}</th>
                          <th className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("employmentType")}>고용형태{renderSortIcon("employmentType")}</th>
                          <th className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("hireDate")}>입사일{renderSortIcon("hireDate")}</th>
                          {empManagementTab === "resigned" && <th className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort("resignDate")}>퇴사일{renderSortIcon("resignDate")}</th>}
                          <th className="px-6 py-4 text-right">상세 정보</th>
                        </>
                      );
                    })()}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(empManagementTab === "working" ? workingEmps : empManagementTab === "resigned" ? resignedEmps : searchResultEmps).map(emp => (
                    <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-sm font-semibold text-slate-800">{emp.storeCode}</td>
                      <td className="px-6 py-4">
                        <span className="font-bold text-slate-900">{emp.name}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-bold px-2.5 py-1 rounded-md border bg-slate-100 text-slate-700">{emp.employmentType}</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-medium">{emp.hireDate || "-"}</td>
                      {empManagementTab === "resigned" && <td className="px-6 py-4 text-sm text-red-600 font-bold">{emp.resignDate}</td>}
                      <td className="px-6 py-4 text-right">
                        <button onClick={() => setSelectedEmpProfile(emp)} className="text-sm bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50 font-semibold transition-colors cursor-pointer shadow-xs">프로필 열람</button>
                      </td>
                    </tr>
                  ))}
                  {(empManagementTab === "working" ? workingEmps : empManagementTab === "resigned" ? resignedEmps : searchResultEmps).length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-slate-400 font-medium">해당하는 직원 데이터가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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

      {/* 🏷️ 근로조건 뱃지 클릭 상세 Modal */}
      <BadgeDetailModal
        isOpen={badgeModalData.isOpen}
        onClose={() => setBadgeModalData({ isOpen: false, emp: null, badge: null })}
        emp={badgeModalData.emp}
        badge={badgeModalData.badge}
        onAction={handleBadgeAction}
      />

      {/* 👥 직원 상세 프로필 모달 (열람 전용) */}
      {selectedEmpProfile && (() => {
        // 마지막 출근일 계산 로직
        const empAtts = attendance.filter(a => a.empId === selectedEmpProfile.id);
        let lastAttDate = "-";
        if (empAtts.length > 0) {
          const sorted = [...empAtts].sort((a,b) => new Date(b.date) - new Date(a.date));
          lastAttDate = sorted[0].date;
        } else if (selectedEmpProfile.hireDate) {
          lastAttDate = `${selectedEmpProfile.hireDate} (출근기록 없음)`;
        }

        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#EF7D25]/10 flex items-center justify-center">
                    <UserCheck className="w-5 h-5 text-[#EF7D25]" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-900">{selectedEmpProfile.name}</h3>
                    <p className="text-sm font-semibold text-slate-500">{selectedEmpProfile.storeCode} · {selectedEmpProfile.employmentType}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedEmpProfile(null)} className="p-2 text-slate-400 hover:bg-slate-200 rounded-full transition-colors cursor-pointer"><X className="w-5 h-5" /></button>
              </div>
              
              {/* Body */}
              <div className="p-6 overflow-y-auto space-y-6">
                {/* 기본 정보 */}
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-2"><UserCheck className="w-4 h-4"/> 기본 신상정보</h4>
                  <div className="bg-slate-50 rounded-2xl p-4 grid grid-cols-2 gap-4 border border-slate-100">
                    <div>
                      <div className="text-xs text-slate-500 font-medium mb-1">주민등록번호</div>
                      <div className="font-bold text-slate-900">{selectedEmpProfile.ssn || "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 font-medium mb-1">연락처 (휴대폰)</div>
                      <div className="font-bold text-slate-900">{selectedEmpProfile.phone || "-"}</div>
                    </div>
                  </div>
                </div>

                {/* 계약 및 소속 정보 */}
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-2"><Briefcase className="w-4 h-4"/> 계약 및 소속 정보</h4>
                  <div className="bg-slate-50 rounded-2xl p-4 grid grid-cols-2 gap-4 border border-slate-100">
                    <div>
                      <div className="text-xs text-slate-500 font-medium mb-1">고용형태</div>
                      <div className="font-bold text-slate-900">{selectedEmpProfile.employmentType || "-"}</div>
                    </div>
                    {selectedEmpProfile.employmentType === "정직원" && (
                      <div>
                        <div className="text-xs text-slate-500 font-medium mb-1">직책/부서</div>
                        <div className="font-bold text-slate-900">{selectedEmpProfile.position || selectedEmpProfile.department || "기본 (담당/매니저)"}</div>
                      </div>
                    )}
                    <div>
                      <div className="text-xs text-slate-500 font-medium mb-1">입사일</div>
                      <div className="font-bold text-slate-900">{selectedEmpProfile.hireDate || "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-blue-500 font-medium mb-1">마지막 출근일</div>
                      <div className="font-bold text-blue-700">{lastAttDate}</div>
                    </div>
                    {selectedEmpProfile.resignDate && (
                      <div>
                        <div className="text-xs text-red-500 font-medium mb-1">퇴사일</div>
                        <div className="font-bold text-red-600">{selectedEmpProfile.resignDate}</div>
                      </div>
                    )}
                  </div>
                </div>

              {/* 계좌 정보 */}
              {role !== "hr" ? (
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-2"><Landmark className="w-4 h-4"/> 급여 계좌 정보</h4>
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                    <div className="text-xs text-slate-500 font-medium mb-1">계좌번호</div>
                    <div className="font-bold text-slate-900">{selectedEmpProfile.account || "등록된 계좌 없음"}</div>
                  </div>
                </div>
              ) : (
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-2"><Lock className="w-4 h-4"/> 급여 계좌 정보</h4>
                  <div className="bg-slate-100 rounded-2xl p-4 border border-slate-200">
                    <div className="text-xs text-slate-500 font-medium mb-1">계좌번호</div>
                    <div className="font-bold text-slate-400 italic">🔒 인사팀 조회 권한 없음</div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button onClick={() => setSelectedEmpProfile(null)} className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-xs transition-colors cursor-pointer">
                닫기
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* 🏝️ 공휴일 날짜 추가 모달 */}
      {isHolidayModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-[#EF7D25] p-4 flex justify-between items-center text-white">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Calendar className="w-5 h-5" /> 공휴일 등록
              </h3>
              <button 
                onClick={() => {
                  setIsHolidayModalOpen(false);
                  setNewHolidayDate("");
                  setNewHolidayName("");
                }} 
                className="text-white/80 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">날짜 선택</label>
                <input
                  type="date"
                  className="w-full border-2 border-slate-200 rounded-xl p-3 text-sm font-bold focus:border-[#EF7D25] focus:ring-0 outline-none transition-colors"
                  value={newHolidayDate}
                  onChange={(e) => setNewHolidayDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">공휴일 이름</label>
                <input
                  type="text"
                  placeholder="예: 어린이날, 대체공휴일 등"
                  className="w-full border-2 border-slate-200 rounded-xl p-3 text-sm font-bold focus:border-[#EF7D25] focus:ring-0 outline-none transition-colors"
                  value={newHolidayName}
                  onChange={(e) => setNewHolidayName(e.target.value)}
                />
              </div>
            </div>
            
            <div className="p-4 bg-slate-50 flex gap-2 justify-end border-t border-slate-100">
              <button
                onClick={() => {
                  setIsHolidayModalOpen(false);
                  setNewHolidayDate("");
                  setNewHolidayName("");
                }}
                className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                onClick={() => {
                  if (!newHolidayDate || !newHolidayName) {
                    alert("날짜와 이름을 모두 입력해주세요.");
                    return;
                  }
                  setCompanyHolidays(prev => [...prev, { id: Date.now(), date: newHolidayDate, name: newHolidayName }]);
                  setIsHolidayModalOpen(false);
                  setNewHolidayDate("");
                  setNewHolidayName("");
                }}
                className="px-4 py-2 text-sm font-bold text-white bg-[#EF7D25] hover:bg-[#d96b1b] rounded-lg shadow-md transition-colors cursor-pointer"
              >
                등록하기
              </button>
            </div>
          </div>
        </div>
      )}

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
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  첨부된 서류 이미지를 확인하고 PC/모바일에 다운로드할 수 있습니다.
                  <br /><span className="text-rose-500 font-bold bg-rose-50 px-1.5 py-0.5 rounded mt-1 inline-block border border-rose-100">※ 개인정보 보호법에 따라 모든 첨부 사진은 업로드일로부터 30일 경과 시 자동 영구 삭제됩니다.</span>
                </p>
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
