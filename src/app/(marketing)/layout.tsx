import type { Metadata } from "next";
import LandingNavbar from "@/modules/marketing/components/LandingNavbar";
import LandingFooter from "@/modules/marketing/components/LandingFooter";

export const metadata: Metadata = {
  title: "MARJYM | Todo tu negocio, en un solo lugar",
  description: "Gestión de inventario, ventas y compras para tu comercio. Incluye Punto de Venta y opciones de E-commerce.",
};

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <LandingNavbar />
      <main className="flex-1">
        {children}
      </main>
      <LandingFooter />
    </>
  );
}
