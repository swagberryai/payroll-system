import re

with open("src/payroll_flow_prototype.jsx", "r") as f:
    content = f.read()

# Find the start of the schedule tab
start_marker = "            {/* ---------------- 📅 스케줄 현황 탭 ---------------- */}"
start_idx = content.find(start_marker)

# We need to find the matching closing bracket for `{((role === "store" && storeTab === "schedule") || (role === "accounting" && accountingSubtab === "schedule")) && (() => {`
# The IIFE ends with `})()}`
# Let's use string manipulation to extract the whole block.
end_marker = "            })()}\n\n          </div>\n        )}\n\n        {/* ---------------- 2. 🏛️ 회계팀 화면"
end_idx = content.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print("Could not find markers")
    print("Start:", start_idx, "End:", end_idx)
    exit(1)

# The block to extract
block = content[start_idx:end_idx + len("            })()}")]
# We should remove the outermost `{((role === "store" && storeTab === "schedule") || (role === "accounting" && accountingSubtab === "schedule")) && (() => {`
# and `})()}` so we just have the function body.

function_body_start = block.find("(() => {\n") + len("(() => {\n")
function_body_end = block.rfind("})()}")

function_body = block[function_body_start:function_body_end]

# create the function definition
func_def = "  const renderScheduleTab = () => {\n" + function_body + "  };\n\n"

# Now find where to insert func_def.
# We'll insert it right before the final `return (` of PayrollFlowPrototype.
return_idx = content.rfind("  return (\n    <div className=\"w-full min-h-screen")
if return_idx == -1:
    print("Could not find return statement")
    exit(1)

# Now, we need to replace the original block in the JSX with `{storeTab === "schedule" && renderScheduleTab()}` inside the store view.
new_content_part1 = content[:start_idx] + "            {storeTab === \"schedule\" && renderScheduleTab()}\n" + content[end_idx + len("            })()}")]

# We also need to add `{accountingSubtab === "schedule" && renderScheduleTab()}` inside the accounting view.
# Let's find where to insert it in the accounting view.
acc_insert_marker = "                <span>스케줄 관리</span>\n              </button>\n\n              <button\n                onClick={() => setAccountingSubtab(\"employees\")}"

# Wait, we already changed the order of buttons.
# Let's just find the end of the tabs navigation div in accounting.
acc_nav_end_marker = "              </button>\n            </div>\n\n            {/* 서브탭 1: 사원등록/퇴사 관리 */}"

# Actually, we can just insert it before "            {/* 서브탭 1"
insert_pos = new_content_part1.find("            {/* 서브탭 1: 사원등록/퇴사 관리 */}")

new_content_part2 = new_content_part1[:insert_pos] + "            {accountingSubtab === \"schedule\" && renderScheduleTab()}\n\n" + new_content_part1[insert_pos:]

# Finally, insert the function definition
final_content = new_content_part2[:return_idx] + func_def + new_content_part2[return_idx:]

with open("src/payroll_flow_prototype.jsx", "w") as f:
    f.write(final_content)

print("Done")
