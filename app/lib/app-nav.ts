export type AppNavItem = {
  label: string;
  href: string;
  activePaths: string[];
  rel?: string;
};

export const appNavItems: AppNavItem[] = [
  {
    label: "Dashboard",
    href: "/app/dashboard",
    activePaths: ["/app", "/app/dashboard"],
    rel: "home",
  },
  { label: "Products", href: "/app/items", activePaths: ["/app/items"] },
  { label: "BOM", href: "/app/boms", activePaths: ["/app/boms"] },
  {
    label: "Customers",
    href: "/app/customers",
    activePaths: ["/app/customers"],
  },
  {
    label: "Suppliers",
    href: "/app/suppliers",
    activePaths: ["/app/suppliers"],
  },
  {
    label: "Orders",
    href: "/app/orders",
    activePaths: ["/app/orders", "/app/order-lines"],
  },
  {
    label: "Inventory",
    href: "/app/inventory",
    activePaths: ["/app/inventory"],
  },
  {
    label: "Procurement",
    href: "/app/procurement",
    activePaths: ["/app/procurement"],
  },
  {
    label: "Receiving",
    href: "/app/receiving",
    activePaths: ["/app/receiving"],
  },
  {
    label: "Logistics",
    href: "/app/logistics",
    activePaths: ["/app/logistics"],
  },
  {
    label: "Settings",
    href: "/app/settings",
    activePaths: ["/app/settings"],
  },
];

export function isActiveNav(pathname: string, navItem: AppNavItem) {
  return navItem.activePaths.some((path) => {
    if (path === "/app") {
      return pathname === "/app";
    }

    return pathname === path || pathname.startsWith(`${path}/`);
  });
}
