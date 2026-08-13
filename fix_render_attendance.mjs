import fs from 'fs';

const filePath = '/Users/pro/Desktop/antigravity/payroll-system/src/payroll_flow_prototype.jsx';
const lines = fs.readFileSync(filePath, 'utf-8').split('\n');

// Find the start and end of renderAttendanceTab
const startIndex = lines.findIndex(line => line.includes('const renderAttendanceTab = () => {'));

// Find the matching end index
let endIndex = -1;
let openBraces = 0;
let started = false;

for (let i = startIndex; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('{')) {
    openBraces += (line.match(/\{/g) || []).length;
    started = true;
  }
  if (line.includes('}')) {
    openBraces -= (line.match(/\}/g) || []).length;
  }
  if (started && openBraces === 0) {
    endIndex = i;
    break;
  }
}

if (startIndex === -1 || endIndex === -1) {
  console.log("Could not find renderAttendanceTab block.");
  process.exit(1);
}

const extractedFunction = lines.slice(startIndex, endIndex + 1);

// Remove the function from its current location
const linesWithoutFunction = [
  ...lines.slice(0, startIndex),
  ...lines.slice(endIndex + 1)
];

// Now find the main return of PayrollFlowPrototype
// PayrollFlowPrototype starts at: export default function PayrollFlowPrototype()
const componentStart = linesWithoutFunction.findIndex(l => l.includes('export default function PayrollFlowPrototype() {'));

// Find the first top-level return inside PayrollFlowPrototype
let mainReturnIndex = -1;
let currentNesting = 0;

for (let i = componentStart; i < linesWithoutFunction.length; i++) {
  const line = linesWithoutFunction[i];
  currentNesting += (line.match(/\{/g) || []).length;
  currentNesting -= (line.match(/\}/g) || []).length;
  
  // A top-level return is typically at nesting 1 inside the main function
  if (currentNesting === 1 && line.trim().startsWith('return (')) {
    mainReturnIndex = i;
    break;
  }
}

if (mainReturnIndex === -1) {
  console.log("Could not find main return.");
  process.exit(1);
}

const finalLines = [
  ...linesWithoutFunction.slice(0, mainReturnIndex),
  '',
  ...extractedFunction,
  '',
  ...linesWithoutFunction.slice(mainReturnIndex)
];

fs.writeFileSync(filePath, finalLines.join('\n'));
console.log('Fixed renderAttendanceTab location.');
