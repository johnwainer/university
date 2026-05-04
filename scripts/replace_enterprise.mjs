import fs from 'fs';

const path = 'apps/web/src/components/AdminApp.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add import
content = content.replace("import './styles.css';", "import './styles.css';\nimport { CompaniesView } from './admin/views/CompaniesView';");

// 2. Replace section
const startStr = "{activeSection === 'enterprise' ? (";
const endStr = "          {activeSection === 'integrations' ? (";

const startIndex = content.indexOf(startStr);
const endIndex = content.indexOf(endStr);

if (startIndex !== -1 && endIndex !== -1) {
  const newSection = `          {activeSection === 'enterprise' ? (
            <CompaniesView 
              sessionToken={sessionToken} 
              setError={setError} 
              setInfo={setInfo} 
              currentUsers={usersData.items} 
              loadUsers={loadUsers} 
              loadBase={loadBase} 
            />
          ) : null}

`;
  content = content.substring(0, startIndex) + newSection + content.substring(endIndex);
}

fs.writeFileSync(path, content, 'utf8');

console.log("Replaced successfully");
