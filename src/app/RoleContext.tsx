/* eslint-disable react-refresh/only-export-components -- module context chia sẻ hook, hằng số và provider trong cùng một tệp */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db } from '../db/database';
import type { Actor, Employee, RoleId } from '../types';
import { ROLE_LABEL } from '../utils/status';

const ROLE_STORAGE_KEY = 'factory.role';
const ROLE_ORDER: RoleId[] = ['MANAGER', 'PLANNER', 'SUPERVISOR', 'QC', 'STOREKEEPER'];

export const DEFAULT_PAGE_BY_ROLE: Record<RoleId, string> = {
  MANAGER: '/dashboard',
  PLANNER: '/orders',
  SUPERVISOR: '/scheduling',
  QC: '/qc',
  STOREKEEPER: '/materials',
};

interface RoleContextValue {
  role: RoleId;
  actor: Actor;
  ready: boolean;
  representative?: Employee;
  options: Array<{ value: RoleId; label: string; employeeName?: string }>;
  setRole: (role: RoleId) => void;
  employeesByRole: Map<RoleId, Employee>;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [ready, setReady] = useState(false);
  const [role, setRoleState] = useState<RoleId>(() => {
    const saved = localStorage.getItem(ROLE_STORAGE_KEY) as RoleId | null;
    return saved && ROLE_ORDER.includes(saved) ? saved : 'MANAGER';
  });

  useEffect(() => {
    let mounted = true;
    db.employees
      .filter((e) => e.active)
      .toArray()
      .then((rows) => {
        if (mounted) {
          setEmployees(rows.sort((a, b) => a.code.localeCompare(b.code)));
          setReady(true);
        }
      })
      .catch(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const employeesByRole = useMemo(() => {
    const map = new Map<RoleId, Employee>();
    for (const employee of employees) {
      // Ưu tiên nhân sự đúng chức danh (giám đốc, kế hoạch, QC, thủ kho) thay vì tổ trưởng kiêm nhiệm
      const current = map.get(employee.role);
      if (!current || (current.position !== 'DIRECTOR' && employee.position === 'DIRECTOR')) {
        map.set(employee.role, employee);
      }
    }
    return map;
  }, [employees]);

  const representative = employeesByRole.get(role);

  const actor: Actor = useMemo(
    () => ({
      employeeId: representative?.id ?? `role-${role.toLowerCase()}`,
      name: representative?.name ?? ROLE_LABEL[role],
      role,
    }),
    [representative, role],
  );

  const options = useMemo(
    () =>
      ROLE_ORDER.map((r) => ({
        value: r,
        label: ROLE_LABEL[r],
        employeeName: employeesByRole.get(r)?.name,
      })),
    [employeesByRole],
  );

  const setRole = (nextRole: RoleId) => {
    setRoleState(nextRole);
    localStorage.setItem(ROLE_STORAGE_KEY, nextRole);
  };

  const value: RoleContextValue = { role, actor, ready, representative, options, setRole, employeesByRole };
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole phải được dùng bên trong RoleProvider');
  return ctx;
}

export function canViewRoute(role: RoleId, pathname: string): boolean {
  const rules: Array<{ prefix: string; roles: RoleId[] }> = [
    { prefix: '/dashboard', roles: ROLE_ORDER },
    { prefix: '/orders', roles: ['MANAGER', 'PLANNER'] },
    { prefix: '/products-bom', roles: ['MANAGER', 'PLANNER', 'STOREKEEPER'] },
    { prefix: '/work-orders', roles: ['MANAGER', 'PLANNER', 'SUPERVISOR', 'QC'] },
    { prefix: '/scheduling', roles: ['MANAGER', 'PLANNER', 'SUPERVISOR'] },
    { prefix: '/logs', roles: ['MANAGER', 'SUPERVISOR'] },
    { prefix: '/qc', roles: ['MANAGER', 'SUPERVISOR', 'QC'] },
    { prefix: '/materials', roles: ['MANAGER', 'STOREKEEPER'] },
    { prefix: '/teams', roles: ['MANAGER', 'SUPERVISOR'] },
    { prefix: '/payroll', roles: ['MANAGER'] },
    { prefix: '/reports', roles: ['MANAGER', 'PLANNER'] },
    { prefix: '/settings', roles: ['MANAGER'] },
  ];
  const rule = rules.find((r) => pathname.startsWith(r.prefix));
  if (!rule) return true;
  return rule.roles.includes(role);
}
