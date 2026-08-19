import sys

file_path = "src/payroll_flow_prototype.jsx"

with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if '{storeTab === "register" && (' in line and start_idx == -1:
        start_idx = i
    elif start_idx != -1 and i > start_idx:
        # We are looking for the closing bracket of the storeTab === "register" condition.
        # It should be right before the attendance tab comment.
        if '{/* ---------------- 🗓️ 새로 개편된 그리드형 일괄 매장 근태 입력 ---------------- */}' in line:
            # The closing bracket should be 2 lines above this comment
            if lines[i-2].strip() == ')}':
                end_idx = i - 2
                break

if start_idx == -1 or end_idx == -1:
    print("Could not find block boundaries")
    print(f"start: {start_idx}, end: {end_idx}")
    sys.exit(1)

new_code = """            {storeTab === "register" && (
              <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-200 mt-2">
                {/* 상단 탭 필터 & 신규 등록 버튼 */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
                    <button onClick={() => setEmpListGroupTab("정직원")} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${empListGroupTab === "정직원" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>정직원</button>
                    <button onClick={() => setEmpListGroupTab("아르바이트")} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${empListGroupTab === "아르바이트" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>아르바이트</button>
                    <button onClick={() => setEmpListGroupTab("일용직")} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${empListGroupTab === "일용직" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>일용직</button>
                    <button onClick={() => setEmpListGroupTab("퇴사자")} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${empListGroupTab === "퇴사자" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>퇴사자</button>
                  </div>
                  <button 
                    onClick={() => { setForm(DEFAULT_EMP_FORM); setEditingEmpId(null); setIsEmpModalOpen(true); }}
                    className="flex items-center gap-2 bg-[#EF7D25] text-white px-5 py-2.5 rounded-xl font-bold shadow-md hover:bg-[#d96b1b] transition-colors cursor-pointer"
                  >
                    <UserPlus className="w-5 h-5" />
                    + 신규 사원 등록
                  </button>
                </div>

                {/* 하단 사원 리스트 (테이블) */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider font-bold">
                        <th className="px-6 py-4">이름</th>
                        <th className="px-6 py-4">주민등록번호</th>
                        <th className="px-6 py-4">연락처</th>
                        <th className="px-6 py-4">입사일</th>
                        {empListGroupTab === "퇴사자" && <th className="px-6 py-4 text-rose-600">퇴사일</th>}
                        <th className="px-6 py-4 text-right">관리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(() => {
                        const filtered = employees.filter(e => e.storeCode === currentStoreObj.id && (empListGroupTab === "퇴사자" ? e.resignDate : (!e.resignDate && e.employmentType === empListGroupTab)));
                        if (filtered.length === 0) {
                          return (
                            <tr>
                              <td colSpan={empListGroupTab === "퇴사자" ? 6 : 5} className="px-6 py-12 text-center text-slate-400 font-medium">해당하는 직원 데이터가 없습니다.</td>
                            </tr>
                          );
                        }
                        return filtered.map(emp => (
                          <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 font-bold text-slate-900">{emp.name}</td>
                            <td className="px-6 py-4 text-sm font-medium text-slate-600">{maskSsn(emp.ssn)}</td>
                            <td className="px-6 py-4 text-sm text-slate-600">{emp.phone}</td>
                            <td className="px-6 py-4 text-sm text-slate-600">{emp.hireDate}</td>
                            {empListGroupTab === "퇴사자" && <td className="px-6 py-4 text-sm text-rose-600 font-bold">{emp.resignDate}</td>}
                            <td className="px-6 py-4 flex justify-end gap-2">
                              <button onClick={() => { 
                                  setForm({...emp}); 
                                  setEditingEmpId(emp.id); 
                                  setIsEmpModalOpen(true); 
                                }} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1 cursor-pointer">
                                <Edit3 className="w-3 h-3"/> 정보수정
                              </button>
                              {empListGroupTab !== "퇴사자" && (
                                <button onClick={() => {
                                  setResigningEmpId(emp.id);
                                  setIsResignModalOpen(true);
                                  setResignDateInput("");
                                }} className="text-xs bg-rose-50 hover:bg-rose-100 text-rose-600 px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1 cursor-pointer">
                                  <LogOut className="w-3 h-3"/> 퇴사처리
                                </button>
                              )}
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
"""

lines = lines[:start_idx] + [new_code] + lines[end_idx+1:]

with open(file_path, "w", encoding="utf-8") as f:
    f.writelines(lines)

print("Replacement successful")
