// 일용직 급여 계산 로직
// 일용직은 아르바이트(시급 × 시간)와 달리, "출근한 날 수 × 일급" 방식으로 계산한다.
// 평일 출근은 평일일급(weekdayWage), 주말/매장 지정 공휴일 출근은 주말일급(weekendWage)과 매칭한다.
// 시간외수당(1.5배) 개념은 적용하지 않는다 — 일당에 이미 포함된 것으로 간주.
export function calculateDailyPayroll(emp, { salaryMonthDates, getCellData, isRed }) {
  let weekdayDaysCount = 0;
  let holidayDaysCount = 0;

  salaryMonthDates.forEach(d => {
    const rec = getCellData(emp.id, d);
    const hrs = parseFloat(rec?.hours) || 0;
    if (hrs > 0) {
      if (isRed(d)) {
        holidayDaysCount++;
      } else {
        weekdayDaysCount++;
      }
    }
  });

  const totalDaysCount = weekdayDaysCount + holidayDaysCount;

  const weekdayWage = Number(emp.weekdayWage) || 0;
  const holidayWage = Number(emp.weekendWage) || 0;

  // 참고용 예상 지급액 — 급여대장 B파트(기본급~차인지급액)는 전부 수기입력이며 이 값과 자동 연동되지 않는다.
  const estimatedPay = (weekdayDaysCount * weekdayWage) + (holidayDaysCount * holidayWage);

  return {
    weekdayDaysCount,
    holidayDaysCount,
    totalDaysCount,
    estimatedPay,
  };
}
