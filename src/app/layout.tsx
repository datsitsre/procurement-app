import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/hooks/useAuth";
import { ToastProvider } from "@/components/ui/Toast";
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Reading headers() opts this layout - and therefore every page under it - into per-request
  // dynamic rendering (Phase 17, section 4). That's required, not incidental: src/proxy.ts's
  // `pageProxy` mints a fresh CSP nonce every request, and Next.js only applies a nonce to its
  // own framework/hydration scripts when the page actually renders per request - a statically
  // prerendered page would bake in one build-time nonce and serve it to every visitor forever,
  // which defeats the entire point of a nonce (see PHASE17_AUDIT.md finding 2 for the trade-off
  // this implies: every previously-static page becomes server-rendered on every request). The
  // value itself isn't otherwise used here - Next parses the nonce back out of the
  // Content-Security-Policy response header itself to attach it to its own scripts.
  await headers();

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
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
