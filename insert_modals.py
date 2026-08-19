import sys

file_path = "src/payroll_flow_prototype.jsx"

with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

insert_idx = -1
for i, line in enumerate(lines):
    if "</main>" in line:
        insert_idx = i + 1
        break

if insert_idx == -1:
    print("Could not find </main>")
    sys.exit(1)

modals_code = """
      {/* 👤 사원 등록 및 수정 모달 */}
      {isEmpModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-8 max-w-3xl w-full shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button onClick={() => setIsEmpModalOpen(false)} className="absolute top-6 right-6 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer">
              <X className="w-6 h-6" />
            </button>
            <div className="flex items-center gap-2 text-xl font-bold text-slate-900 mb-6 pb-4 border-b border-slate-100">
              {editingEmpId ? <Edit3 className="w-6 h-6 text-[#EF7D25]" /> : <UserPlus className="w-6 h-6 text-[#EF7D25]" />}
              <h2>{editingEmpId ? `✏️ "${form.name}" 사원 서류 보완 및 수정` : "신규 사원 등록"}</h2>
            </div>

            {editingEmpId && (
              <div className="mb-6 bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm font-semibold text-[#EF7D25]">
                💡 <strong>"{form.name}"</strong> 사원의 기존 정보가 로드되었습니다. 수정 후 하단 [수정완료] 버튼을 누르세요.
              </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-base">
              <Field label="성명 *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="예: 홍길동" />
              <Field label="주민등록번호 *" value={form.ssn} onChange={(v) => setForm({ ...form, ssn: v })} placeholder="900101-1234567" />
              <Field label="연락처 *" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="010-0000-0000" />
              <Field label="입사일 *" type="date" value={form.hireDate} onChange={(v) => setForm({ ...form, hireDate: v })} />
              <Field label="계좌번호" value={form.account} onChange={(v) => setForm({ ...form, account: v })} placeholder="은행명 및 계좌번호" />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-bold text-slate-700">소속 매장 (수정 불가)</label>
                <div className="bg-slate-100 text-slate-600 font-bold px-4 py-2.5 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Store className="w-4 h-4 text-[#EF7D25]" /> {currentStoreObj.name}
                  </div>
                  <span className="text-xs bg-slate-200 px-2 py-0.5 rounded-md">고정됨</span>
                </div>
              </div>
              <Field label="고용형태 *" type="select" value={form.employmentType} onChange={(v) => setForm({ ...form, employmentType: v })} options={["정직원", "아르바이트", "일용직"]} />
            </div>

            <div className="mt-8">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-bold text-slate-700">첨부서류 (클릭 후 사진 첨부)</label>
                <span className="text-xs font-bold text-rose-500 bg-rose-50 px-2 py-1 rounded">※ 등록 후 30일 경과 시 자동 파기</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {HR_DOCS.map((doc) => (
                  <button
                    key={doc.key}
                    type="button"
                    onClick={() => handleFileUpload(doc.key)}
                    className={`p-3 rounded-xl border text-sm font-bold flex flex-col items-center justify-center gap-2 transition-all shadow-xs cursor-pointer ${
                      form[doc.key]
                        ? "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                        : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    {form[doc.key] ? <FileCheck className="w-5 h-5 text-emerald-600" /> : <FilePlus className="w-5 h-5" />}
                    {doc.label} {form[doc.key] ? "첨부됨" : "미첨부"}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setIsEmpModalOpen(false)} className="px-6 py-3 rounded-xl font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer">
                취소
              </button>
              <button
                onClick={() => {
                  handleEmpSubmit();
                  setIsEmpModalOpen(false);
                }}
                className="px-8 py-3 rounded-xl font-black bg-[#EF7D25] hover:bg-[#d96b1b] text-white transition-all shadow-md cursor-pointer"
              >
                {editingEmpId ? "수정완료" : "사원 등록"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🚪 퇴사 처리 모달 */}
      {isResignModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl relative">
            <button onClick={() => setIsResignModalOpen(false)} className="absolute top-6 right-6 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer">
              <X className="w-6 h-6" />
            </button>
            <div className="flex items-center gap-2 text-xl font-bold text-slate-900 mb-6">
              <LogOut className="w-6 h-6 text-rose-600" />
              <h2>직원 퇴사 처리</h2>
            </div>
            
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              퇴사일을 입력해주세요. 퇴사 처리된 직원은 <strong>[퇴사자]</strong> 탭으로 이동하며, 이후 근태 입력 및 급여 계산 명단에서 제외됩니다.
            </p>

            <div className="mb-8">
              <label className="block text-sm font-bold text-slate-700 mb-2">퇴사일 *</label>
              <input 
                type="date" 
                value={resignDateInput}
                onChange={(e) => setResignDateInput(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-4 py-3 text-base font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => setIsResignModalOpen(false)} className="px-5 py-2.5 rounded-xl font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer">
                취소
              </button>
              <button
                onClick={() => {
                  if (!resignDateInput) {
                    alert("퇴사일을 입력해주세요.");
                    return;
                  }
                  const updated = employees.map(e => e.id === resigningEmpId ? { ...e, resignDate: resignDateInput } : e);
                  setEmployees(updated);
                  setIsResignModalOpen(false);
                  setToast({ type: "success", msg: "퇴사 처리가 완료되었습니다." });
                  setTimeout(() => setToast(null), 3000);
                }}
                className="px-6 py-2.5 rounded-xl font-black bg-rose-600 hover:bg-rose-700 text-white transition-all shadow-md cursor-pointer"
              >
                퇴사 처리 확정
              </button>
            </div>
          </div>
        </div>
      )}
"""

lines = lines[:insert_idx] + [modals_code] + lines[insert_idx:]

with open(file_path, "w", encoding="utf-8") as f:
    f.writelines(lines)

print("Modals inserted successfully")
