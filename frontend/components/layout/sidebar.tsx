'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Laptop,
  FileText,
  Truck,
  Wallet,
  ScanLine,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Boxes,
  Building2,
  FileUp,
  Tags,
  FileDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Ativos', href: '/ativos', icon: Laptop },
  { label: 'Contratos', href: '/contratos', icon: FileText },
  { label: 'Fornecedores', href: '/fornecedores', icon: Truck },
  { label: 'Clientes e Obras', href: '/clientes', icon: Building2 },
  { label: 'Preços de Referência', href: '/precos-referencia', icon: Tags },
  { label: 'Financeiro', href: '/financeiro', icon: Wallet },
  { label: 'Importar Extrato', href: '/importar-extrato', icon: FileUp },
  { label: 'Conciliação PDF', href: '/conciliacao', icon: ScanLine },
  { label: 'Relatórios', href: '/relatorios', icon: FileDown },
];

const NAV_ITEMS_FOOTER: NavItem[] = [{ label: 'Configurações', href: '/configuracoes', icon: Settings }];

/**
 * Sidebar retrátil (collapse persistido em localStorage). Em telas pequenas,
 * o componente pai deve controlar a visibilidade via um Sheet/overlay — este
 * componente cuida apenas do estado expandido/recolhido em telas médias+.
 */
export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    const stored = localStorage.getItem('itam:sidebar-collapsed');
    if (stored) setCollapsed(stored === 'true');
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      localStorage.setItem('itam:sidebar-collapsed', String(!prev));
      return !prev;
    });
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-in-out',
          collapsed ? 'w-[68px]' : 'w-64',
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Boxes className="h-4.5 w-4.5" />
          </div>
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-tight">Portal TI · Ativos</span>
          )}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV_ITEMS.map((item) => (
            <SidebarLink key={item.href} item={item} active={pathname?.startsWith(item.href)} collapsed={collapsed} />
          ))}
        </nav>

        <div className="space-y-1 border-t border-border px-3 py-4">
          {NAV_ITEMS_FOOTER.map((item) => (
            <SidebarLink key={item.href} item={item} active={pathname?.startsWith(item.href)} collapsed={collapsed} />
          ))}
          <button
            onClick={toggle}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            {!collapsed && <span>Recolher</span>}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}

function SidebarLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active?: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      <Icon className="h-4.5 w-4.5 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}
