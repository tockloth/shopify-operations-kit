import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const location = useLocation();

  const navItems = [
    {
      label: "Dashboard",
      href: "/app/dashboard",
      activePaths: ["/app", "/app/dashboard"],
      rel: "home",
    },
    { label: "Products", href: "/app/items", activePaths: ["/app/items"] },
    { label: "BOM", href: "/app/boms", activePaths: ["/app/boms"] },
    { label: "Customers", href: "/app/customers", activePaths: ["/app/customers"] },
    { label: "Suppliers", href: "/app/suppliers", activePaths: ["/app/suppliers"] },
    {
      label: "Orders",
      href: "/app/orders",
      activePaths: ["/app/orders", "/app/order-lines"],
    },
    { label: "Inventory", href: "/app/inventory", activePaths: ["/app/inventory"] },
    { label: "Procurement", href: "/app/procurement", activePaths: ["/app/procurement"] },
    { label: "Logistics", href: "/app/logistics", activePaths: ["/app/logistics"] },
    { label: "Settings", href: "/app/settings", activePaths: ["/app/settings"] },
  ];

  const isActive = (paths: string[]) =>
    paths.some((path) => {
      if (path === "/app") {
        return location.pathname === "/app";
      }

      return location.pathname === path || location.pathname.startsWith(`${path}/`);
    });

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        {navItems.map((item) => {
          const active = isActive(item.activePaths);

          return (
            <s-link
              key={item.href}
              href={item.href}
              {...({ rel: item.rel, "aria-current": active ? "page" : undefined } as any)}
            >
              {active ? <strong>{item.label}</strong> : item.label}
            </s-link>
          );
        })}
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
