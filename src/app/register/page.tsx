'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { CountryCode, CurrencyCode } from '@/types/common';

const countryOptions: { value: CountryCode; label: string; currency: CurrencyCode }[] = [
  { value: 'GH', label: 'Ghana', currency: 'GHS' },
  { value: 'NG', label: 'Nigeria', currency: 'NGN' },
  { value: 'KE', label: 'Kenya', currency: 'KES' },
  { value: 'ZA', label: 'South Africa', currency: 'ZAR' },
  { value: 'CI', label: "Côte d'Ivoire", currency: 'XOF' },
];

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();

  const [companyName, setCompanyName] = useState('');
  const [country, setCountry] = useState<CountryCode>('GH');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const currency = countryOptions.find((c) => c.value === country)!.currency;
    const err = await register({ companyName, country, currency, fullName, email, password });
    setSubmitting(false);

    if (err) {
      setError(err.message);
      setFieldErrors(err.fieldErrors ?? {});
      return;
    }

    router.push('/dashboard');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            P
          </span>
          <span className="text-h3">Procurement</span>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-h2 mb-1">Create your company account</h1>
          <p className="text-body mb-6 text-text-secondary">
            You&rsquo;ll be the owner of this company&rsquo;s procurement workspace.
          </p>

          {error && (
            <div role="alert" className="mb-4 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <Input
              label="Company name"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Technologies Ltd."
            />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="country" className="text-sm font-medium text-text-primary">
                Country
              </label>
              <select
                id="country"
                value={country}
                onChange={(e) => setCountry(e.target.value as CountryCode)}
                className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {countryOptions.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label} ({c.currency})
                  </option>
                ))}
              </select>
            </div>

            <Input
              label="Your full name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Mensah"
            />
            <Input
              label="Work email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={fieldErrors.email}
            />
            <Input
              label="Password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint="At least 8 characters"
              error={fieldErrors.password}
            />

            <Button type="submit" loading={submitting} className="mt-1 w-full">
              Create account
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-caption">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
