import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { MainLayout } from '../layouts/MainLayout';
import { canViewRoute, DEFAULT_PAGE_BY_ROLE, useRole } from './RoleContext';
import { NotFoundPage } from '../modules/misc/NotFoundPage';
import { AccessDeniedPage } from '../modules/misc/AccessDeniedPage';
import { DashboardPage } from '../modules/dashboard/DashboardPage';
import { OrdersPage } from '../modules/orders/OrdersPage';
import { OrderDetailPage } from '../modules/orders/OrderDetailPage';
import { ProductsPage } from '../modules/products/ProductsPage';
import { WorkOrdersPage } from '../modules/work-orders/WorkOrdersPage';
import { WorkOrderDetailPage } from '../modules/work-orders/WorkOrderDetailPage';
import { SchedulingPage } from '../modules/scheduling/SchedulingPage';
import { LogsPage } from '../modules/logs/LogsPage';
import { QcPage } from '../modules/qc/QcPage';
import { MaterialsPage } from '../modules/materials/MaterialsPage';
import { TeamsPage } from '../modules/teams/TeamsPage';
import { PayrollPage } from '../modules/payroll/PayrollPage';
import { ReportsPage } from '../modules/reports/ReportsPage';
import { SettingsPage } from '../modules/settings/SettingsPage';

function Guard({ path, children }: { path: string; children: ReactNode }) {
  const { role } = useRole();
  if (!canViewRoute(role, path)) return <AccessDeniedPage />;
  return <>{children}</>;
}

function HomeRedirect() {
  const { role } = useRole();
  return <Navigate to={DEFAULT_PAGE_BY_ROLE[role]} replace />;
}

function CurrentPath() {
  const location = useLocation();
  return <NotFoundPage path={location.pathname} />;
}

export function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<HomeRedirect />} />
          <Route
            path="/dashboard"
            element={
              <Guard path="/dashboard">
                <DashboardPage />
              </Guard>
            }
          />
          <Route
            path="/orders"
            element={
              <Guard path="/orders">
                <OrdersPage />
              </Guard>
            }
          />
          <Route
            path="/orders/:orderId"
            element={
              <Guard path="/orders">
                <OrderDetailPage />
              </Guard>
            }
          />
          <Route
            path="/products-bom"
            element={
              <Guard path="/products-bom">
                <ProductsPage />
              </Guard>
            }
          />
          <Route
            path="/work-orders"
            element={
              <Guard path="/work-orders">
                <WorkOrdersPage />
              </Guard>
            }
          />
          <Route
            path="/work-orders/:workOrderId"
            element={
              <Guard path="/work-orders">
                <WorkOrderDetailPage />
              </Guard>
            }
          />
          <Route
            path="/scheduling"
            element={
              <Guard path="/scheduling">
                <SchedulingPage />
              </Guard>
            }
          />
          <Route
            path="/logs"
            element={
              <Guard path="/logs">
                <LogsPage />
              </Guard>
            }
          />
          <Route
            path="/qc"
            element={
              <Guard path="/qc">
                <QcPage />
              </Guard>
            }
          />
          <Route
            path="/materials"
            element={
              <Guard path="/materials">
                <MaterialsPage />
              </Guard>
            }
          />
          <Route
            path="/teams"
            element={
              <Guard path="/teams">
                <TeamsPage />
              </Guard>
            }
          />
          <Route
            path="/payroll"
            element={
              <Guard path="/payroll">
                <PayrollPage />
              </Guard>
            }
          />
          <Route
            path="/reports"
            element={
              <Guard path="/reports">
                <ReportsPage />
              </Guard>
            }
          />
          <Route
            path="/settings"
            element={
              <Guard path="/settings">
                <SettingsPage />
              </Guard>
            }
          />
          <Route path="*" element={<CurrentPath />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
