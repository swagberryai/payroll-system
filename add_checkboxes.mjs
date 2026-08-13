import fs from 'fs';

const filePath = '/Users/pro/Desktop/antigravity/payroll-system/src/payroll_flow_prototype.jsx';
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Add state variable
content = content.replace(
  'const [selectedParttimeIds, setSelectedParttimeIds] = useState(new Set());',
  'const [selectedFulltimeIds, setSelectedFulltimeIds] = useState(new Set());\n  const [selectedParttimeIds, setSelectedParttimeIds] = useState(new Set());'
);

// 2. Add import functions
const importParttimeStr = `  // 2. 선택한 아르바이트 우측 작업창으로 가져오기`;
const newImportFunctions = `  // 1-5. 선택한 정직원 우측 작업창으로 가져오기
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
            rowId: \`ft_\${emp.id}_\${Date.now()}_\${Math.random()}\`,
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
    flash(\`정직원 \${count}명을 우측 작업창으로 가져왔습니다!\`);
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
          rowId: \`pt_\${emp.id}_\${Date.now()}_\${Math.random()}\`,
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
    flash(\`아르바이트 \${count}명을 우측 작업창으로 가져왔습니다!\`);
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
          rowId: \`dy_\${emp.id}_\${Date.now()}_\${Math.random()}\`,
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
    flash(\`일용직 \${count}명을 우측 작업창으로 가져왔습니다!\`);
  };

`;
content = content.replace(importParttimeStr, newImportFunctions + importParttimeStr);


// 3. Update Fulltime UI list
const oldFulltimeTop = `<div className="text-xs text-slate-500 mb-2 font-medium">
                            💡 정직원은 출근을 하지 않아도 휴무/결근 기입을 위해 전원을 불러옵니다. (가나다순 정렬)
                          </div>`;
const newFulltimeTop = `<div className="text-xs text-slate-500 mb-2 font-medium flex justify-between items-center">
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
                          </div>`;
content = content.replace(oldFulltimeTop, newFulltimeTop);

const oldFulltimeRow = `                            return (
                              <div key={e.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-sm">
                                <div className="flex items-center flex-wrap gap-1.5">
                                  <span className="font-bold text-slate-900">{e.name}</span>`;

const newFulltimeRow = `                            const isChecked = selectedFulltimeIds.has(e.id);
                            return (
                              <label
                                key={e.id}
                                className={\`p-3 border rounded-xl flex items-center justify-between text-sm cursor-pointer select-none transition-all \${
                                  isChecked
                                    ? "bg-orange-50/80 border-[#EF7D25] font-bold text-slate-900 shadow-xs"
                                    : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                                }\`}
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
                                  <span className="font-bold text-slate-900">{e.name}</span>`;
content = content.replace(oldFulltimeRow, newFulltimeRow);

// Replace </div> closing tag of the old row with </label>
// The old row ends with:
//                                 <span className="text-xs font-semibold text-slate-500 shrink-0">정직원</span>
//                               </div>
// But looking closely at parttime, it replaces the outer div with label.
content = content.replace(
  `                                <span className="text-xs font-semibold text-slate-500 shrink-0">정직원</span>
                              </div>`,
  `                                <span className="text-xs font-semibold text-slate-500 shrink-0">정직원</span>
                              </label>`
);


// 4. Update Parttime header to add '전체선택'
const oldParttimeTop = `<div className="text-xs text-slate-500 mb-2 font-medium">
                            💡 오늘 출근한 아르바이트생을 체크하세요. (선택된 인원만 불러옵니다)
                          </div>`;
const newParttimeTop = `<div className="text-xs text-slate-500 mb-2 font-medium flex justify-between items-center">
                            <span>💡 오늘 출근한 아르바이트생을 체크하세요.</span>
                            <button
                              type="button"
                              onClick={() => {
                                if (selectedParttimeIds.size === parttimeEmps.length) setSelectedParttimeIds(new Set());
                                else setSelectedParttimeIds(new Set(parttimeEmps.map(e => e.id)));
                              }}
                              className="text-[11px] text-[#EF7D25] underline font-bold cursor-pointer"
                            >
                              {selectedParttimeIds.size === parttimeEmps.length ? "전체해제" : "전체선택"}
                            </button>
                          </div>`;
content = content.replace(oldParttimeTop, newParttimeTop);

// 5. Update bottom buttons
const oldButtonsBlock = `{/* 하단 고정 가져오기 버튼 */}
                    <div className="pt-4 border-t border-slate-100">
                      {attTargetTab === "fulltime" && (
                        <button
                          type="button"
                          onClick={importAllFulltime}
                          className="w-full bg-[#EF7D25] hover:bg-[#d96b1b] text-white text-sm font-extrabold py-3.5 rounded-xl shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer"
                        >
                          <ArrowRightCircle className="w-4 h-4" />
                          정직원 전체 가져오기 ({fulltimeEmps.length}명 ➔ 작업창)
                        </button>
                      )}
                      {attTargetTab === "parttime" && (
                        <button
                          type="button"
                          onClick={importSelectedParttime}
                          disabled={selectedParttimeIds.size === 0}
                          className="w-full bg-[#EF7D25] hover:bg-[#d96b1b] text-white text-sm font-extrabold py-3.5 rounded-xl shadow-md disabled:opacity-40 flex items-center justify-center gap-2 transition-all cursor-pointer"
                        >
                          <ArrowRightCircle className="w-4 h-4" />
                          선택한 아르바이트 가져오기 ({selectedParttimeIds.size}명 ➔ 작업창)
                        </button>
                      )}
                      {attTargetTab === "daily" && (
                        <button
                          type="button"
                          onClick={importSelectedDaily}
                          disabled={selectedDailyIds.size === 0}
                          className="w-full bg-[#EF7D25] hover:bg-[#d96b1b] text-white text-sm font-extrabold py-3.5 rounded-xl shadow-md disabled:opacity-40 flex items-center justify-center gap-2 transition-all cursor-pointer"
                        >
                          <ArrowRightCircle className="w-4 h-4" />
                          선택한 일용직 가져오기 ({selectedDailyIds.size}명 ➔ 작업창)
                        </button>
                      )}
                    </div>`;

const newButtonsBlock = `{/* 하단 고정 가져오기 버튼 */}
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
                    </div>`;

content = content.replace(oldButtonsBlock, newButtonsBlock);

fs.writeFileSync(filePath, content);
console.log("Successfully added checkboxes and buttons for all target categories.");
