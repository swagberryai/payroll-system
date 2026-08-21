with open("src/payroll_flow_prototype.jsx", "r") as f:
    content = f.read()

# Find the accounting block start
acc_start_marker = '        {/* ---------------- 2. 🏛️ 회계팀 화면 (주민번호/계좌번호 원본 무마스킹 표시 및 대조 지원) ---------------- */}'
acc_idx = content.find(acc_start_marker)

# Find the end of the tabs navigation inside the accounting block
tabs_end_marker = '              </button>\n            </div>\n\n            {/* 서브탭 1: 사원등록 확인 목록'
tabs_end_idx = content.find(tabs_end_marker, acc_idx)
if tabs_end_idx == -1:
    print("Could not find tabs end marker")
    exit(1)

# The tabs block we want to extract
tabs_block = content[acc_idx : tabs_end_idx + len('              </button>\n            </div>\n\n')]

# We'll remove it from the original location
new_content_part2 = content[:acc_idx] + content[tabs_end_idx + len('              </button>\n            </div>\n\n'):]

# And we'll insert it right after `<main className=...>`
main_marker = 'mx-auto mt-2 transition-all duration-300`}>\n'
main_idx = new_content_part2.find(main_marker)
if main_idx == -1:
    print("Could not find main marker")
    exit(1)

insert_pos = main_idx + len(main_marker)

final_content = new_content_part2[:insert_pos] + tabs_block + new_content_part2[insert_pos:]

# Wait, in the tabs block, we have `        {role === "accounting" && (\n          <div>\n`
# We need to close it.
# Wait, no. If I just move the tabs block, it will look like:
# {role === "accounting" && (
#   <div>
#     <div className="flex gap-3 mb-6"> ... tabs ... </div>
# And the opening `{role === "accounting" && ( \n <div>` was included in the extraction.
# So I need to add `</div>)}` at the end of the extracted tabs block!
# And I need to ADD a NEW `{role === "accounting" && ( \n <div>` to the remaining accounting block!

# Let's do this more cleanly.
# The tabs navigation is just:
#             <div className="flex gap-3 mb-6">
#               ...
#             </div>

tabs_inner_start = content.find('            <div className="flex gap-3 mb-6">', acc_idx)
tabs_inner_end = tabs_end_idx + len('              </button>\n            </div>\n')

tabs_inner = content[tabs_inner_start : tabs_inner_end]

# Remove it from the accounting block
new_content_part2 = content[:tabs_inner_start] + content[tabs_inner_end:]

# Create a new wrapper for the top
top_tabs_block = '        {role === "accounting" && (\n' + tabs_inner + '        )}\n\n'

final_content = new_content_part2[:insert_pos] + top_tabs_block + new_content_part2[insert_pos:]

with open("src/payroll_flow_prototype.jsx", "w") as f:
    f.write(final_content)

print("Done")
