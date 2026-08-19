file_path = "src/payroll_flow_prototype.jsx"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Fix 1: Add LogOut and FilePlus to imports
old_import = '''  CheckCircle2, Circle, AlertTriangle, Clock, ImagePlus, Check, X, Users, RefreshCw, Download, ArrowRight, ShieldAlert, Edit3, Trash2, Key, UserCheck, PlusCircle, ShieldCheck, MapPin, Phone, FileText, LayoutDashboard, DollarSign, AlertCircle, FileCheck, Calendar, ArrowRightCircle, Trash, Save, Sliders, HelpCircle, ChevronRight'''
new_import = '''  CheckCircle2, Circle, AlertTriangle, Clock, ImagePlus, Check, X, Users, RefreshCw, Download, ArrowRight, ShieldAlert, Edit3, Trash2, Key, UserCheck, PlusCircle, ShieldCheck, MapPin, Phone, FileText, LayoutDashboard, DollarSign, AlertCircle, FileCheck, Calendar, ArrowRightCircle, Trash, Save, Sliders, HelpCircle, ChevronRight, LogOut, FilePlus'''

content = content.replace(old_import, new_import, 1)

# Fix 2: Replace the entire employee modal with a correct version
old_modal_start = "      {/* 👤 사원 등록 및 수정 모달 */}"
old_modal_end = "      {/* 🚪 퇴사 처리 모달 */}"

# Find positions
idx_start = content.find(old_modal_start)
idx_end = content.find(old_modal_end)

if idx_start == -1 or idx_end == -1:
    print(f"Could not find modal markers. start={idx_start}, end={idx_end}")
    exit(1)

new_modal = '''      {/* 👤 사원 등록 및 수정 모달 */}
      {isEmpModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-8 max-w-3xl w-full shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button onClick={() => { setIsEmpModalOpen(false); cancelEdit(); }} className="absolute top-6 right-6 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-base">
              <Field label="성명 *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="예: 홍길동" />
              <Field label="주민등록번호 *" value={form.ssn} onChange={(v) => setForm({ ...form, ssn: v })} placeholder="900101-1234567" />
              <Field label="연락처 *" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="010-0000-0000" />
              <Field label="입사일 *" type="date" value={form.hireDate} onChange={(v) => setForm({ ...form, hireDate: v })} />
              <Field label="계좌번호" value={form.account} onChange={(v) => setForm({ ...form, account: v })} placeholder="은행명 및 계좌번호" />
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">소속 매장 <span className="text-xs text-slate-400 font-normal">(자동 매칭 · 수정 불가)</span></label>
                <div className="w-full border border-slate-300 rounded-xl px-4 py-3 text-base font-bold text-slate-700 bg-slate-100 cursor-not-allowed shadow-xs flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-slate-900"><Store className="w-4 h-4 text-[#EF7D25]" /> {currentStoreCode}</span>
                  <span className="text-xs font-extrabold px-2 py-0.5 bg-slate-200 text-slate-600 rounded-md">고정됨</span>
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

            <div className="mt-6">
              <div className="text-sm font-semibold text-slate-700 mb-2 flex flex-wrap items-center justify-between gap-2">
                <span>첨부서류 (클릭 후 사진 첨부)</span>
                <span className="text-rose-500 font-bold text-xs bg-rose-50 px-2 py-0.5 rounded border border-rose-200">※ 등록 후 30일 경과 시 자동 파기</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {DOCS.map((d) => {
                  const fileData = form[d.key];
                  const isAttached = Boolean(fileData);
                  return (
                    <label key={d.key} className={`flex items-center justify-center gap-1.5 text-sm font-semibold px-3 py-3 rounded-xl border transition-all cursor-pointer select-none text-center ${isAttached ? "bg-emerald-50 border-2 border-emerald-500 text-emerald-800 font-bold shadow-xs" : "bg-slate-50 border border-slate-300 text-slate-600 hover:bg-slate-100"}`}>
                      <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
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
                      }} />
                      {isAttached ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <ImagePlus className="w-4 h-4 text-slate-400 shrink-0" />}
                      <span className="truncate">{d.label} {isAttached ? "첨부완료" : "미첨부"}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {formError && (
              <div className="mt-5 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">⚠️ {formError}</div>
            )}

            <div className="mt-8 pt-6 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => { setIsEmpModalOpen(false); cancelEdit(); }} className="px-6 py-3 rounded-xl font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer">
                취소
              </button>
              <button
                onClick={async () => {
                  await submitRegister();
                  if (!formError) setIsEmpModalOpen(false);
                }}
                className="px-8 py-3 rounded-xl font-black bg-[#EF7D25] hover:bg-[#d96b1b] text-white transition-all shadow-md cursor-pointer"
              >
                {editingEmpId ? "수정완료" : "사원 등록"}
              </button>
            </div>
          </div>
        </div>
      )}

      '''

content = content[:idx_start] + new_modal + content[idx_end:]

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Modal fixed successfully")
