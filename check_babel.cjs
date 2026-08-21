const fs = require('fs');
const { parse } = require('@babel/parser');

const code = fs.readFileSync('./src/payroll_flow_prototype.jsx', 'utf-8');

try {
  parse(code, {
    sourceType: 'module',
    plugins: ['jsx']
  });
  console.log('SUCCESS');
} catch (e) {
  console.error(e.message);
}
