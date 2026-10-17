import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { isPublicDemo } from "@/config/demo-mode";
import { RepositoryProvider } from "@/infrastructure/providers/RepositoryProvider";
import { ToastProvider } from "@/shared/components/Toast";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MARJYM",
  description: "Proyecto base del frontend web de MARJYM.",
  // La demo publica no debe indexarse: la que se posiciona es la landing real.
  ...(isPublicDemo() ? { robots: { index: false, follow: false } } : {}),
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <RepositoryProvider>
          <ToastProvider>{children}</ToastProvider>
        </RepositoryProvider>
      </body>
    </html>
  );
}
