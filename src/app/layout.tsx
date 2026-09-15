import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/hooks/useAuth";
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
  title: {
    default: "Procurement Platform",
    template: "%s | Procurement Platform",
  },
  description:
    "B2B e-commerce and procurement platform - discover products, request quotes, manage approvals, and track orders.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // A browser extension (seen locally: "crxlauncher") can inject attributes like
      // crxlauncher-bridged/crxlauncher onto <html> before React hydrates, which React then
      // reports as a hydration mismatch even though nothing in this app's own render differs
      // between server and client. suppressHydrationWarning on this one element is the
      // documented fix for exactly this case - https://react.dev/link/hydration-mismatch.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-text-primary">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
