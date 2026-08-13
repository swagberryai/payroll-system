import fs from 'fs';

const filePath = '/Users/pro/Desktop/antigravity/payroll-system/src/payroll_flow_prototype.jsx';
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Add suspectedResignations and allResignedEmployees
const targetStateAnchor = `  const pendingResignations = useMemo(() => employees.filter((e) => e.resignDate && !e.resignConfirmed), [employees]);`;

const injectedState = `  const pendingResignations = useMemo(() => employees.filter((e) => e.resignDate && !e.resignConfirmed), [employees]);

  const suspectedResignations = useMemo(() => {
    const todayDate = new Date(currentKstDay || "2025-02-13");
    return employees.filter(e => {
      if (e.resignDate) return false;
      if (e.employmentType === "일용직") return false;
      
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
  }, [employees, attendance, currentKstDay]);

  const allResignedEmployees = useMemo(() => {
    return [...employees].filter(e => e.resignDate).sort((a,b) => new Date(b.resignDate) - new Date(a.resignDate));
  }, [employees]);
`;
content = content.replace(targetStateAnchor, injectedState);

// 2. Add suspectedResignations to alert count
content = content.replace(
  `{(waitingAccounting.length + pendingResignations.length) > 0 && (`,
  `{(waitingAccounting.length + pendingResignations.length + suspectedResignations.length) > 0 && (`
).replace(
  `{waitingAccounting.length + pendingResignations.length}`,
  `{waitingAccounting.length + pendingResignations.length + suspectedResignations.length}`
);
content = content.replace(
  `{(waitingAccounting.length + pendingResignations.length) > 0 && (`,
  `{(waitingAccounting.length + pendingResignations.length + suspectedResignations.length) > 0 && (`
).replace(
  `{waitingAccounting.length + pendingResignations.length}`,
  `{waitingAccounting.length + pendingResignations.length + suspectedResignations.length}`
);

// 3. Add UI in accounting confirm subtab
const confirmSubtabUIAnchor = `{/* 🚨 퇴사자 발생 확인 알림 카드 목록 */}`;

const injectedConfirmUI = `{/* 🚨 2주 이상 무단 결근 (퇴직 의심자) 알림 배너 */}
                {suspectedResignations.length > 0 && (
                  <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-6 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 text-lg font-bold text-amber-800 border-b border-amber-200 pb-3">
                      <AlertTriangle className="w-5.5 h-5.5 text-amber-600" />
                      <h2>🚨 2주 이상 장기 미출근 (퇴직 의심) 알림 ({suspectedResignations.length}명)</h2>
                    </div>
                    <p className="text-xs text-amber-700">마지막 출근일 또는 입사일로부터 14일 이상 출근 기록이 없는 정직원/아르바이트 명단입니다.</p>
                    
                    <div className="space-y-3">
                      {suspectedResignations.map((e) => (
                        <div key={e.id} className="bg-white border border-amber-300 rounded-xl p-4 flex flex-wrap justify-between items-center gap-4 shadow-xs">
                          <div className="space-y-1">
                            <div className="text-base font-bold text-slate-900">
                              <span className="text-amber-700 mr-2">[{e.storeCode}]</span>
                              {e.name}
                              <span className="text-xs font-semibold px-2 py-0.5 bg-slate-200 text-slate-700 rounded-md ml-2">{e.employmentType}</span>
                            </div>
                            <div className="text-sm text-slate-600 font-medium">
                              입사일: <strong className="text-slate-900">{e.hireDate}</strong>
                            </div>
                          </div>
                          
                          <button
                            onClick={() => {
                              // Switch to store view and open edit to set resignDate
                              setRole("store");
                              setCurrentStoreCode(e.storeCode);
                              setStoreTab("employee");
                              // Note: Edit employee logic normally runs there, but here we can just show flash
                              flash("해당 매장의 사원관리 메뉴에서 퇴사일을 입력해주세요.");
                            }}
                            className="bg-slate-800 hover:bg-slate-900 text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow-xs transition-all cursor-pointer"
                          >
                            매장 사원관리로 이동
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 🚨 퇴사자 발생 확인 알림 카드 목록 */}`;

content = content.replace(confirmSubtabUIAnchor, injectedConfirmUI);

// 4. Add "Past Resignations List" at the bottom of confirm tab
const confirmTabEndAnchor = `{/* 서브탭 2: 급여/노무 통합 Dashboard (기존 대시보드) */}`;

const injectedPastResignations = `{/* 👻 과거 퇴직자 명단 조회 공간 */}
                <div className="bg-white rounded-2xl border border-slate-200/90 p-8 shadow-sm">
                  <div className="flex items-center gap-2 text-xl font-bold text-slate-900 mb-2">
                    <Users className="w-6 h-6 text-slate-500" />
                    <h2>전체 퇴직자 명단 조회</h2>
                  </div>
                  <p className="text-sm text-slate-500 mb-6">
                    🔍 시스템 상 퇴사일이 입력된 모든 사원의 히스토리입니다.
                  </p>
                  
                  <div className="space-y-4">
                    {allResignedEmployees.length === 0 && (
                      <div className="text-base text-slate-500 p-8 border border-dashed border-slate-300 rounded-xl text-center">
                        퇴직자 기록이 없습니다.
                      </div>
                    )}
                    {allResignedEmployees.map((e) => (
                      <div key={e.id} className="border border-slate-200 rounded-xl p-4 bg-slate-50 hover:bg-white transition-all shadow-xs flex flex-wrap justify-between items-center gap-4">
                        <div className="space-y-1">
                          <div className="font-bold text-slate-900">
                            {e.name} <span className="text-xs font-semibold px-2 py-0.5 bg-slate-200 text-slate-700 rounded-md ml-2">{e.employmentType} · {e.storeCode}</span>
                          </div>
                          <div className="text-sm text-slate-600">
                            입사일: {e.hireDate} | 퇴사일: <strong className="text-rose-600">{e.resignDate}</strong>
                          </div>
                        </div>
                        {e.resignConfirmed ? (
                          <span className="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">회계팀 확인완료</span>
                        ) : (
                          <span className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg">회계팀 확인 대기중</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

            {/* 서브탭 2: 급여/노무 통합 Dashboard (기존 대시보드) */}`;

content = content.replace(confirmTabEndAnchor, injectedPastResignations);

fs.writeFileSync(filePath, content);
console.log("Successfully added resignation features.");
