import fs from 'fs';

const adminAppPath = 'apps/web/src/components/AdminApp.tsx';
let content = fs.readFileSync(adminAppPath, 'utf8');

const views = [
  { id: 'overview', name: 'OverviewView' },
  { id: 'connections', name: 'ConnectionsView' },
  { id: 'users', name: 'UsersView' },
  { id: 'courses', name: 'CoursesView' },
  { id: 'enterprise', name: 'CompaniesView' },
  { id: 'webinars', name: 'WebinarsView' },
  { id: 'podcasts', name: 'PodcastsView' },
  { id: 'integrations', name: 'IntegrationsView' }
];

console.log("Ready to refactor");
