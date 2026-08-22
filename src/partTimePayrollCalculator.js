// 아르바이트/일용직 급여 계산 로직
// src/payroll_flow_prototype.jsx 의 급여대장 화면(6484~6549행)에서 그대로 옮겨온 함수입니다.
// 계산 결과가 분리 전과 100% 동일하도록, 로직을 변경하지 않고 위치만 이동했습니다.
export function calculatePartTimePayroll(emp, { salaryMonthDates, getCellData, companyHolidays, currentStoreObj, getPayrollCell }) {
  let workDaysCount = 0;
  let normalHoursSum = 0;
  let otHoursSum = 0;
  let holidayHoursSum = 0;

  salaryMonthDates.forEach(d => {
    const rec = getCellData(emp.id, d);
    const hrs = parseFloat(rec?.hours) || 0;
    if (hrs > 0) {
      workDaysCount++;
      const isCompanyHoliday = (companyHolidays || []).some(h => h.date === d);

      let dailyNormal = 0;
      let dailyOt = 0;
      let dailyHoliday = 0;

      if (hrs > 10) {
        dailyOt = hrs - 10;
        if (isCompanyHoliday) {
          dailyHoliday = 10;
        } else {
          dailyNormal = 10;
        }
      } else {
        if (isCompanyHoliday) {
          dailyHoliday = hrs;
        } else {
          dailyNormal = hrs;
        }
      }

      normalHoursSum += dailyNormal;
      otHoursSum += dailyOt;
      holidayHoursSum += dailyHoliday;
    }
  });
  const totalHoursSum = normalHoursSum + otHoursSum + holidayHoursSum;

  const socialConfig = currentStoreObj?.rules?.socialInsurance || { targetHours: 60, targetDays: 8 };
  const is4MajorEligible = emp.is4MajorInsurance === true || (totalHoursSum >= socialConfig.targetHours || workDaysCount >= socialConfig.targetDays);

  // -----------------------------------------
  // 자동 계산 로직 (아르바이트/일용직)
  // -----------------------------------------
  const hourlyWage = Number(emp.hourlyWage) || 10030; // 기본 최저시급 대체

  // 급여 계산 (사용자 요청 수식 반영)
  const calcBasePay = normalHoursSum * hourlyWage;
  const calcOtPay = Math.round(otHoursSum * hourlyWage * 1.5);
  const calcHolidayPay = Math.round(holidayHoursSum * hourlyWage * 1.5);
  const calcGrossPay = calcBasePay + calcOtPay + calcHolidayPay;

  // 공제액 계산 (10원 단위 절사)
  const calcNationalPension = emp.nationalPension === '60세 이상 미가입' ? '60세' : (Number(emp.nationalPension) || 0);
  const calcNationalPensionNum = isNaN(Number(calcNationalPension)) ? 0 : Number(calcNationalPension);
  const calcHealthIns = is4MajorEligible ? Math.floor(calcGrossPay * 0.03595 / 10) * 10 : 0;
  const calcLongTermCare = is4MajorEligible ? Math.floor(calcHealthIns * 0.1314 / 10) * 10 : 0;
  const calcEmploymentIns = is4MajorEligible ? Math.floor(calcGrossPay * 0.009 / 10) * 10 : 0;
  const calcIncomeTax = Number(emp.incomeTax) || 0;
  const calcLocalTax = Number(emp.localTax) || 0;
  const calcOtherDeduction = Number(getPayrollCell(emp.id, 'otherDeduction')) || 0;

  const calcDeductionTotal = calcNationalPensionNum + calcHealthIns + calcLongTermCare + calcEmploymentIns + calcIncomeTax + calcLocalTax + calcOtherDeduction;

  const calcNetPay = calcGrossPay - calcDeductionTotal;

  return {
    workDaysCount,
    normalHoursSum,
    otHoursSum,
    holidayHoursSum,
    totalHoursSum,
    is4MajorEligible,
    calcBasePay,
    calcOtPay,
    calcHolidayPay,
    calcGrossPay,
    calcNationalPension,
    calcNationalPensionNum,
    calcHealthIns,
    calcLongTermCare,
    calcEmploymentIns,
    calcIncomeTax,
    calcLocalTax,
    calcOtherDeduction,
    calcDeductionTotal,
    calcNetPay,
  };
}
