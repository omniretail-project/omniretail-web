"use client";

import Link from "next/link";
import type { ComponentType, SVGProps } from "react";
import { navigationConfig } from "@/config/navigation";
import { useCatalogImageUrl } from "@/infrastructure/media/useCatalogImageUrl";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useInicioBusinessIdentity } from "@/modules/auth/hooks/useInicioBusinessIdentity";
import { BrandMark } from "@/shared/components/BrandMark";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";
import { isNavigationItemPermitted } from "@/shared/navigation/Sidebar";
import type { NavigationItem } from "@/shared/types/navigation.types";

type QuickAccessModuleId =
  | "administration"
  | "inventory"
  | "purchasing"
  | "receiving"
  | "pos"
  | "logistics";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const quickAccessDefinitions = [
  {
    moduleId: "administration",
    ids: ["administration", "admin"],
    title: "Administración",
    description: "Gestione la configuración y los recursos del negocio.",
  },
  {
    moduleId: "inventory",
    ids: ["inventory"],
    title: "Inventario",
    description: "Consulte existencias, alertas y movimientos de inventario.",
  },
  {
    moduleId: "purchasing",
    ids: ["purchasing", "purchases"],
    title: "Compras",
    description: "Administre órdenes de compra y abastecimiento.",
  },
  {
    moduleId: "receiving",
    ids: ["receiving", "receipts"],
    title: "Recepciones",
    description: "Registre y consulte la recepción de mercadería.",
  },
  {
    moduleId: "pos",
    ids: ["pos"],
    title: "Punto de venta",
    description: "Acceda a ventas, caja y operaciones del punto de venta.",
  },
  {
    moduleId: "logistics",
    ids: ["logistics"],
    title: "Logística",
    description: "Coordine preparación, despacho y seguimiento de pedidos.",
  },
] as const;

const QUICK_ACCESS_ICON_MAP: Record<QuickAccessModuleId, IconComponent> = {
  administration: BuildingIcon,
  inventory: BoxesIcon,
  purchasing: ShoppingCartIcon,
  receiving: PackageCheckIcon,
  pos: ShoppingCartIcon,
  logistics: TruckIcon,
};

function normalizeNavigationValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function findFirstPermittedRoute(
  item: NavigationItem,
  allowedPermissions: ReadonlySet<string>,
): NavigationItem | null {
  if (item.href && isNavigationItemPermitted(item, allowedPermissions)) return item;

  for (const child of item.children ?? []) {
    const destination = findFirstPermittedRoute(child, allowedPermissions);
    if (destination) return destination;
  }

  return null;
}

export function InicioPage() {
  const { loading: sessionLoading, permissions, role, user } = useCurrentSession();
  const { currentBranch, loading: branchLoading } = useActiveBranch();
  const {
    identity,
    loading: identityLoading,
    error: identityError,
  } = useInicioBusinessIdentity(user?.tenantId);
  const logoUrl = useCatalogImageUrl(user?.tenantId, identity?.logo, "");
  const businessName = identity?.businessName ?? "MARJYM";
  const loadingIdentity = sessionLoading || identityLoading;
  const hasCustomLogo = Boolean(identity?.logo && !identityError);
  const allowedPermissions = new Set(permissions);
  const quickAccessItems = quickAccessDefinitions.flatMap((definition) => {
    const normalizedTitle = normalizeNavigationValue(definition.title);
    const navigationItem = navigationConfig.find((item) => {
      const normalizedId = normalizeNavigationValue(item.id);
      const normalizedLabel = normalizeNavigationValue(item.label);
      return (
        definition.ids.some((id) => normalizedId === id || normalizedId.startsWith(`${id}-`)) ||
        normalizedLabel === normalizedTitle
      );
    });
    if (!navigationItem) return [];

    const destination = findFirstPermittedRoute(navigationItem, allowedPermissions);
    if (!destination?.href) return [];

    return [
      {
        ...definition,
        href: destination.href,
        icon: QUICK_ACCESS_ICON_MAP[definition.moduleId],
      },
    ];
  });

  return (
    <main className="mx-auto w-full min-w-0 max-w-7xl space-y-6">
      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm sm:p-6">
        {loadingIdentity ? (
          <div
            aria-label="Cargando identidad del negocio"
            className="flex min-h-[60px] animate-pulse items-center gap-4"
            role="status"
          >
            <span className="h-[60px] w-[60px] rounded-xl bg-[var(--color-app-background)]" />
            <span className="h-6 w-40 rounded bg-[var(--color-app-background)]" />
          </div>
        ) : (
          <div className="flex min-h-[60px] min-w-0 items-center gap-4">
            {hasCustomLogo ? (
              logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- resolved catalog media may be an object URL.
                <img
                  alt={`Logo de ${businessName}`}
                  className="max-h-16 max-w-40 shrink-0 object-contain sm:max-w-56"
                  src={logoUrl}
                />
              ) : (
                <span
                  aria-label="Cargando logo del negocio"
                  className="h-[60px] w-[60px] shrink-0 animate-pulse rounded-xl bg-[var(--color-app-background)]"
                  role="status"
                />
              )
            ) : (
              <BrandMark />
            )}
            {(hasCustomLogo || businessName !== "MARJYM") && (
              <p className="min-w-0 break-words text-xl font-bold text-[var(--color-title)] sm:text-2xl">
                {businessName}
              </p>
            )}
          </div>
        )}

        <h1 className="mt-4 text-2xl font-bold text-[var(--color-title)]">
          Hola{user?.name ? `, ${user.name}` : ""}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-[var(--color-app-background)] px-3 py-1.5 text-[var(--color-text)]">
            {role ? `Sesión activa como ${role.name}.` : "Sesión activa."}
          </span>
          <span className="rounded-full bg-[var(--color-app-background)] px-3 py-1.5 text-[var(--color-text)]">
            {branchLoading
              ? "Cargando sucursal activa..."
              : currentBranch
                ? `Sucursal activa: ${currentBranch.name}`
                : "Sin sucursal activa"}
          </span>
        </div>
      </section>

      <section aria-labelledby="quick-access-title" className="min-w-0">
        <div className="mb-3">
          <h2 id="quick-access-title" className="text-xl font-bold text-[var(--color-title)]">
            Accesos rápidos
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Ingrese directamente a las áreas disponibles para su rol.
          </p>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quickAccessItems.map(({ description, href, icon: Icon, title }) => (
            <Link
              className="group flex min-w-0 items-center gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm transition hover:border-[var(--color-structure)] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
              href={href}
              key={title}
            >
              {Icon && (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--color-app-background)] text-[var(--color-structure)]">
                  <Icon aria-hidden="true" className="h-5 w-5" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-[var(--color-structure)]">{title}</span>
                <span className="mt-1 block text-sm leading-5 text-[var(--color-text-muted)]">
                  {description}
                </span>
              </span>
              <ArrowRightIcon
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-[var(--color-structure)] transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

function SvgIcon({ children, className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  );
}

function BuildingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SvgIcon {...props}>
      <path d="M3 21h18" />
      <path d="M5 21V7l8-4v18" />
      <path d="M19 21V11l-6-4" />
      <path d="M9 9h1M9 13h1M9 17h1" />
    </SvgIcon>
  );
}

function BoxesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SvgIcon {...props}>
      <path d="m7.5 4.3 4.5 2.6 4.5-2.6" />
      <path d="M3 8.5 12 14l9-5.5" />
      <path d="M12 14v8" />
      <path d="M3 8.5v7L12 21l9-5.5v-7" />
    </SvgIcon>
  );
}

function ShoppingCartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SvgIcon {...props}>
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
      <path d="M2 3h3l3 13h10l3-9H6" />
    </SvgIcon>
  );
}

function PackageCheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SvgIcon {...props}>
      <path d="m3 7 9 5 9-5M12 22V12" />
      <path d="M21 7v5M3 7v10l9 5 2.5-1.4" />
      <path d="m16 17 2 2 4-5" />
    </SvgIcon>
  );
}

function TruckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SvgIcon {...props}>
      <path d="M10 17h4V5H2v12h3" />
      <path d="M14 8h4l4 4v5h-3" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </SvgIcon>
  );
}

function ArrowRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SvgIcon {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </SvgIcon>
  );
}
