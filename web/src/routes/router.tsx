// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { useAuthStore } from "@/lib/auth-store";
import { LoginPage } from "./login";
import { RegisterPage } from "./register";
import { RecoveryPage } from "./recovery";
import { LockPage } from "./lock";
import { AuthLayout } from "./auth-layout";
import { VaultItemsPage } from "./vault-items";
import { VaultItemDetailPage } from "./vault-item-detail";
import { VaultNewItemPage } from "./vault-new-item";
import { SettingsPage } from "./settings";
import { NotificationsPage } from "./notifications";
import { ActivityPage } from "./activity";
import { AdminPage } from "./admin";
import { HealthPage } from "./health";
import { VaultTrashPage } from "./vault-trash";

// Root route
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// Public routes
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  component: RegisterPage,
});

const recoveryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recovery",
  component: RecoveryPage,
});

const lockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lock",
  component: LockPage,
});

// Authenticated layout (pathless - doesn't add to URL)
const authLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "auth",
  component: AuthLayout,
  beforeLoad: () => {
    const { isAuthenticated, isLocked } = useAuthStore.getState();
    if (!isAuthenticated) {
      throw redirect({ to: "/login" });
    }
    if (isLocked) {
      throw redirect({ to: "/lock" });
    }
  },
});

// Vault routes
const vaultRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/vault/$vaultId",
  component: () => <Outlet />,
});

const vaultItemsRoute = createRoute({
  getParentRoute: () => vaultRoute,
  path: "/",
  component: VaultItemsPage,
});

const vaultNewItemRoute = createRoute({
  getParentRoute: () => vaultRoute,
  path: "/items/new",
  component: VaultNewItemPage,
});

const vaultItemDetailRoute = createRoute({
  getParentRoute: () => vaultRoute,
  path: "/items/$itemId",
  component: VaultItemDetailPage,
});

const vaultTrashRoute = createRoute({
  getParentRoute: () => vaultRoute,
  path: "/trash",
  component: VaultTrashPage,
});

// Settings route
const settingsRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/settings",
  component: SettingsPage,
});

// Notifications route
const notificationsRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/notifications",
  component: NotificationsPage,
});

// Activity (audit) route
const activityRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/activity",
  component: ActivityPage,
});

// Admin route
const adminRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/admin",
  component: AdminPage,
});

// Password health route
const healthRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/health",
  component: HealthPage,
});

// Index redirect
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState();
    if (!isAuthenticated) {
      throw redirect({ to: "/login" });
    }
    // Will redirect to first vault in Phase 2 login flow
    throw redirect({ to: "/login" });
  },
});

// Route tree
const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  recoveryRoute,
  lockRoute,
  authLayout.addChildren([
    settingsRoute,
    notificationsRoute,
    activityRoute,
    adminRoute,
    healthRoute,
    vaultRoute.addChildren([
      vaultItemsRoute,
      vaultNewItemRoute,
      vaultItemDetailRoute,
      vaultTrashRoute,
    ]),
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
