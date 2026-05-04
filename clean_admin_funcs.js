const fs = require('fs');
let code = fs.readFileSync('apps/web/src/components/AdminApp.tsx', 'utf8');

function removeBetween(startStr, endStr) {
  const start = code.indexOf(startStr);
  if (start === -1) return;
  const end = code.indexOf(endStr, start);
  if (end === -1) return;
  code = code.substring(0, start) + code.substring(end + endStr.length);
}

// 1. Remove loadCompanies
removeBetween('const loadCompanies = async', '};');

// 2. Remove loadCompanies from bootstrap and refreshAll
code = code.replace(/loadCompanies\(sessionToken\),?/g, '');

// 3. Remove onCreateCompany down to onToggleCompanyCourse
// The last function is onToggleCompanyCourse before onSubmitWebinar
// Wait, onSubmitWebinar comes right after onToggleCompanyCourse. So we can just remove all text between onCreateCompany and onSubmitWebinar.
const startCreate = code.indexOf('const onCreateCompany = async');
const startWebinar = code.indexOf('const onSubmitWebinar = async');
if (startCreate !== -1 && startWebinar !== -1) {
  code = code.substring(0, startCreate) + code.substring(startWebinar);
}

// 4. Remove onSyncEnterprise
removeBetween('const onSyncEnterprise = async () => {', '};\n\n  const onCreateUser');

// 5. Remove the "Sync empresas" button from the Connections tab
// It's inside a button tag
const btnStart = code.indexOf('<button onClick={() => void onSyncEnterprise()}');
if (btnStart !== -1) {
  const btnEnd = code.indexOf('</button>', btnStart) + 9;
  code = code.substring(0, btnStart) + code.substring(btnEnd);
}

fs.writeFileSync('apps/web/src/components/AdminApp.tsx', code);
console.log('Cleaned up AdminApp.tsx');
