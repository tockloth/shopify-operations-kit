export type AppNavItem = {
  label: string;
  href: string;
  activePaths: string[];
  rel?: string;
};

export const appNavItems: AppNavItem[] = [
  {
    label: "Start",
    href: "/app/dashboard",
    activePaths: ["/app", "/app/dashboard"],
    rel: "home",
  },
  {
    label: "01 Orders",
    href: "/app/orders",
    activePaths: ["/app/orders", "/app/order-lines"],
  },
  { label: "02 Products", href: "/app/items", activePaths: ["/app/items"] },
  {
    label: "03 Procurement",
    href: "/app/procurement",
    activePaths: ["/app/procurement"],
  },
  {
    label: "04 Receiving",
    href: "/app/receiving",
    activePaths: ["/app/receiving"],
  },
  {
    label: "05 Inventory",
    href: "/app/inventory",
    activePaths: ["/app/inventory"],
  },
  {
    label: "06 Payments",
    href: "/app/payments",
    activePaths: ["/app/payments"],
  },
  {
    label: "07 Logistics",
    href: "/app/logistics",
    activePaths: ["/app/logistics"],
  },
  {
    label: "08 Customers",
    href: "/app/customers",
    activePaths: ["/app/customers"],
  },
  {
    label: "09 Suppliers",
    href: "/app/suppliers",
    activePaths: ["/app/suppliers"],
  },
  { label: "10 BOM / Kitting", href: "/app/boms", activePaths: ["/app/boms"] },
  {
    label: "11 Settings",
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
