import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
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

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app/dashboard" {...({ rel: "home" } as any)}>
          Dashboard
        </s-link>
        <s-link href="/app/items">Products</s-link>
        <s-link href="/app/customers">Customers</s-link>
        <s-link href="/app/suppliers">Suppliers</s-link>
        <s-link href="/app/orders">Orders</s-link>
        <s-link href="/app/inventory">Inventory</s-link>
        <s-link href="/app/procurement">Procurement</s-link>
        <s-link href="/app/logistics">Logistics</s-link>
        <s-link href="/app/settings">Settings</s-link>
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
