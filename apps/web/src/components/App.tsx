import { AdminApp } from './AdminApp';
import { PublicApp } from './PublicApp';

export function App() {
  const path = window.location.pathname;
  if (path.startsWith('/admin')) {
    return <AdminApp />;
  }
  return <PublicApp />;
}
