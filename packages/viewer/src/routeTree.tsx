import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import { Home } from "./routes/Home";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});

export const routeTree = rootRoute.addChildren([indexRoute]);
