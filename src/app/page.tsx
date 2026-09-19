'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, FileText, ShieldCheck, TrendingUp } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';

export default function LandingPage() {
  const router = useRouter();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading && session) {
      router.replace('/dashboard');
    }
  }, [loading, session, router]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              P
            </span>
            <span className="text-h3">Procurement</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm font-medium text-text-secondary hover:text-text-primary">
              Sign in
            </Link>
            <Button onClick={() => router.push('/register')}>Get started</Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-20 lg:px-6">
          <div className="max-w-2xl">
            <p className="text-metadata mb-3 text-accent">B2B procurement, built for Africa</p>
            <h1 className="text-h1 mb-4 text-4xl">
              Run your company&rsquo;s entire purchasing lifecycle in one place.
            </h1>
            <p className="text-body mb-8 max-w-xl text-text-secondary">
              Discover verified suppliers, request quotations, route purchases through your own
              approval rules, and track every order and invoice - from Accra to anywhere your
              business operates.
            </p>
            <div className="flex gap-3">
              <Button size="lg" onClick={() => router.push('/register')}>
                Create your company account
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => router.push('/login')}>
                Sign in
              </Button>
            </div>
          </div>

          <div className="mt-16 grid gap-4 sm:grid-cols-3">
            <FeatureCard
              icon={FileText}
              title="Request for quotation"
              description="Send one RFQ to multiple suppliers and compare quotes side by side before you commit."
            />
            <FeatureCard
              icon={ShieldCheck}
              title="Configurable approvals"
              description="Route purchase requests through your company's own spend-based approval rules."
            />
            <FeatureCard
              icon={TrendingUp}
              title="Procurement analytics"
              description="See spend by supplier and category, and track savings across every order."
            />
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-surface px-4 py-6 text-center text-caption lg:px-6">
        Demo platform - fictional companies and suppliers only.
      </footer>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-info-bg text-accent">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="text-h3 mb-1">{title}</p>
      <p className="text-body text-text-secondary">{description}</p>
    </div>
  );
}
