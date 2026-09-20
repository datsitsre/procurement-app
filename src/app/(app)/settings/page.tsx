'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Camera } from 'lucide-react';
import { useAuth, useActiveCompany, useActiveMembership, useWorkspace } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { Permission, RoleLabels } from '@/config/rbac';
import { formatMoney } from '@/utils/format';
import { resizeImageToDataUrl } from '@/utils/image';

export default function SettingsPage() {
  const workspace = useWorkspace();
  const company = useActiveCompany();
  const membership = useActiveMembership();
  const { can } = useAuth();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1">Settings</h1>

      <ProfileCard />

      {workspace === 'platform' ? (
        // Platform Headquarters is not an ordinary buyer/supplier company (section 11/13) - this
        // card deliberately never shows company-shaped fields (payment terms, credit limit, ...)
        // that would only be meaningful for a real transacting company.
        <Card>
          <CardHeader>
            <CardTitle>Platform administration</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Organization" value={company?.name} />
              <Field label="Role" value={membership && RoleLabels[membership.role]} />
            </dl>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Company profile</CardTitle>
            {can(Permission.SETTINGS_MANAGE) && (
              <Link href="/settings/company">
                <Button variant="outline" size="sm">
                  Manage company
                </Button>
              </Link>
            )}
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Company name" value={company?.name} />
              <Field label="Country" value={company?.country} />
              <Field label="Currency" value={company?.currency} />
              {workspace === 'buyer' && <Field label="Payment terms" value={company?.creditTerms.replace('_', ' ')} />}
              {workspace === 'buyer' && company?.creditLimit !== undefined && (
                <Field label="Credit limit" value={formatMoney(company.creditLimit, company.currency)} />
              )}
              {workspace === 'buyer' && company?.creditAvailable !== undefined && (
                <Field label="Credit available" value={formatMoney(company.creditAvailable, company.currency)} />
              )}
            </dl>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your access</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Role" value={membership && RoleLabels[membership.role]} />
            <Field label="Department" value={membership?.department ?? '—'} />
            <Field label="Status" value={membership?.status} />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileCard() {
  const { session, updateProfile } = useAuth();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(session?.user.name ?? '');
  const [phone, setPhone] = useState(session?.user.phone ?? '');
  const [pendingAvatar, setPendingAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!session) return null;

  const displayAvatar = pendingAvatar ?? session.user.avatarUrl;
  const dirty = name.trim() !== session.user.name || phone.trim() !== (session.user.phone ?? '') || pendingAvatar !== null;

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-picked later if they cancel out
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.show('Choose an image file.', 'error');
      return;
    }
    try {
      setPendingAvatar(await resizeImageToDataUrl(file));
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Could not process that image.', 'error');
    }
  }

  async function submit() {
    setSaving(true);
    const err = await updateProfile({
      name: name.trim(),
      phone: phone.trim(),
      ...(pendingAvatar !== null ? { avatarUrl: pendingAvatar } : {}),
    });
    setSaving(false);
    if (err) {
      toast.show(err.message, 'error');
      return;
    }
    setPendingAvatar(null);
    toast.show('Profile updated.', 'success');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your profile</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar name={session.user.name} imageUrl={displayAvatar} size="lg" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Change photo"
              className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-text-secondary hover:text-text-primary"
            >
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
          </div>
          <div>
            <p className="text-sm font-medium">{session.user.email}</p>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="text-sm font-medium text-accent hover:underline">
              Change photo
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>

        <Button className="w-fit" onClick={submit} loading={saving} disabled={!dirty || !name.trim()}>
          Save changes
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-metadata">{label}</dt>
      <dd className="text-sm font-medium">{value ?? '—'}</dd>
    </div>
  );
}
