import { Sidebar } from '@/components/layout/sidebar';
import { RequireAuth } from '@/components/auth/require-auth';

export default function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1">{children}</div>
      </div>
    </RequireAuth>
  );
}
