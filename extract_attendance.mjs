import fs from 'fs';

const filePath = 'src/payroll_flow_prototype.jsx';
const lines = fs.readFileSync(filePath, 'utf-8').split('\n');

// 1. Locate the block
const startLineIdx = 1683; // 0-indexed, so 1684 is '{storeTab === "attendance" && ('
const endLineIdx = 2287;   // 0-indexed, so 2288 is ')}'

const block = lines.slice(startLineIdx + 1, endLineIdx); // The div space-y-6 block

// 2. Wrap it
const extractedFunction = [
  '  const renderAttendanceTab = () => {',
  '    return (',
  ...block,
  '    );',
  '  };',
  ''
];

// 3. Remove the original block and replace with function call
// Replace lines 1684-2288 (indices 1683 to 2287) with `{storeTab === "attendance" && renderAttendanceTab()}`
const beforeBlock = lines.slice(0, 1683);
const afterBlock = lines.slice(2288);

const newLinesWithReplacedCall = [
  ...beforeBlock,
  '            {storeTab === "attendance" && renderAttendanceTab()}',
  ...afterBlock
];

// 4. Insert `extractedFunction` before the main return statement
// Find `return (` inside newLinesWithReplacedCall (it was around line 1259 originally)
const returnIdx = newLinesWithReplacedCall.findIndex(line => line === '  return (');

const finalLines = [
  ...newLinesWithReplacedCall.slice(0, returnIdx),
  ...extractedFunction,
  ...newLinesWithReplacedCall.slice(returnIdx)
];

fs.writeFileSync(filePath, finalLines.join('\n'));
console.log('Extraction complete.');
