const fs = require('fs');
let code = fs.readFileSync('apps/web/src/components/AdminApp.tsx', 'utf8');

// Regex or string replacement to remove the old state and functions from AdminApp:
const statesToRemove = [
  'const [companiesData, setCompaniesData] = useState<CompanyRecord[]>([]);',
  'const [selectedCompanyId, setSelectedCompanyId] = useState(\'\');',
  'const [selectedCompanyMembers, setSelectedCompanyMembers] = useState<CompanyMemberRecord[]>([]);',
  'const [selectedCompanyCourses, setSelectedCompanyCourses] = useState<CompanyCourseAccessRecord[]>([]);',
  'const [selectedCompanyStats, setSelectedCompanyStats] = useState<CompanyDashboardStats | null>(null);',
  'const [selectedCompanyMemberProgress, setSelectedCompanyMemberProgress] = useState<CompanyUserProgressRecord[]>([]);',
  'const [loadingCompanies, setLoadingCompanies] = useState(false);',
  'const [savingCompany, setSavingCompany] = useState(false);',
  'const [savingCompanyMember, setSavingCompanyMember] = useState(false);',
  'const [savingCompanyCourse, setSavingCompanyCourse] = useState(false);',
  'const [syncingEnterprise, setSyncingEnterprise] = useState(false);'
].forEach(str => {
  code = code.replace(str, '');
});

const objectsToRemove = [
  `const [companyForm, setCompanyForm] = useState({
    name: '',
    slug: '',
    description: '',
    contactEmail: '',
    representativeUserId: '',
    isActive: true
  });`,
  `const [companyMemberForm, setCompanyMemberForm] = useState({
    userId: '',
    fullName: '',
    email: '',
    locale: 'es'
  });`,
  `const [editingCompanyMemberId, setEditingCompanyMemberId] = useState<string | null>(null);`,
  `const [editingCompanyMemberForm, setEditingCompanyMemberForm] = useState({
    fullName: '',
    email: '',
    role: 'collaborator' as 'representative' | 'collaborator'
  });`,
  `const [companyCourseId, setCompanyCourseId] = useState('');`,
  `const [companyCourseSearch, setCompanyCourseSearch] = useState('');`,
  `const [allCoursesList, setAllCoursesList] = useState<{ moodle_course_id: number; full_name: string }[]>([]);`
].forEach(str => {
  code = code.replace(str, '');
});

// We need to carefully remove the functions. It is safer to use standard manipulation or ask the agent to do it.

fs.writeFileSync('apps/web/src/components/AdminApp.tsx', code);
