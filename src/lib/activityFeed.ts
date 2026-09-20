import {
  ShieldAlert,
  UserPlus,
  UserCog,
  UserCheck,
  UserX,
  Building2,
  ShieldCheck,
  FileCheck2,
  FileX2,
  PiggyBank,
  ClipboardList,
  RefreshCw,
  Award,
  Mail,
  MailX,
  Activity as ActivityIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AuditEntry } from '@/types/common';

export type ActivityCategory = 'role' | 'user' | 'company' | 'supplier' | 'approval' | 'security' | 'other';

export interface ActivityDescription {
  /** A short, human sentence fragment - "changed a team member's role", not the raw action
   *  code. Always derived from the real `action` string this AuditLog row actually recorded -
   *  never fabricated for an action this list doesn't recognize (falls back to a humanized
   *  version of the raw code instead, so nothing is ever silently hidden). */
  label: string;
  icon: LucideIcon;
  category: ActivityCategory;
}

/** Maps every real audit `action` string this codebase's `recordAudit` calls ever write (see
 *  `grep -rn "action: '" src/server/services` for the authoritative list this was built from) to
 *  a friendlier label/icon/category for the Activity Center and dashboard Recent Activity panel.
 *  Both read the exact same `AuditLog` rows via the exact same `GET /api/audit-log` - this is a
 *  presentation layer over that one audit system, never a second one (section 16). An action
 *  this map doesn't recognize still renders (humanized fallback), so a future action type is
 *  never silently dropped from the feed. */
const ACTION_DESCRIPTIONS: Record<string, Omit<ActivityDescription, 'label'> & { label: string }> = {
  TEAM_MEMBER_ADDED: { label: 'added a team member', icon: UserPlus, category: 'user' },
  TEAM_MEMBER_ROLE_CHANGED: { label: "changed a team member's role", icon: UserCog, category: 'role' },
  TEAM_MEMBER_SUSPENDED: { label: 'suspended a team member', icon: UserX, category: 'user' },
  TEAM_MEMBER_ACTIVATED: { label: 'reactivated a team member', icon: UserCheck, category: 'user' },
  TEAM_MEMBER_OFFBOARDED: { label: 'offboarded a team member', icon: UserX, category: 'user' },
  TEAM_MEMBER_PASSWORD_RESET_REQUESTED: { label: "requested a team member's password reset", icon: RefreshCw, category: 'user' },
  TEAM_MEMBER_INVITED: { label: 'invited a team member', icon: Mail, category: 'user' },
  TEAM_MEMBER_INVITATION_RESENT: { label: 'resent a team member invitation', icon: RefreshCw, category: 'user' },
  TEAM_MEMBER_INVITATION_REVOKED: { label: 'revoked a team member invitation', icon: MailX, category: 'user' },
  TEAM_MEMBER_INVITATION_ACCEPTED: { label: 'accepted a team invitation', icon: UserCheck, category: 'user' },
  PLATFORM_USER_INVITED: { label: 'invited a platform user', icon: Mail, category: 'user' },
  PLATFORM_ROLE_CHANGED: { label: "changed a platform user's role", icon: UserCog, category: 'role' },
  REGISTRATION_APPROVED: { label: 'approved a registration', icon: UserCheck, category: 'approval' },
  REGISTRATION_REJECTED: { label: 'rejected a registration', icon: UserX, category: 'approval' },
  USER_ACTIVATED: { label: 'reactivated an account', icon: UserCheck, category: 'user' },
  USER_SUSPENDED: { label: 'suspended an account', icon: UserX, category: 'user' },
  SUPPLIER_VERIFICATION_CHANGED: { label: "changed a supplier's verification status", icon: ShieldCheck, category: 'supplier' },
  PRODUCT_MODERATED: { label: 'moderated a product listing', icon: FileCheck2, category: 'supplier' },
  PURCHASE_REQUEST_APPROVED: { label: 'approved a purchase request', icon: FileCheck2, category: 'approval' },
  PURCHASE_REQUEST_REJECTED: { label: 'rejected a purchase request', icon: FileX2, category: 'approval' },
  RFQ_QUOTE_ACCEPTED: { label: 'accepted a supplier quote', icon: Award, category: 'company' },
  DISPUTE_RESOLVED: { label: 'resolved a dispute', icon: ShieldAlert, category: 'company' },
  BUDGET_CREATED: { label: 'created a budget', icon: PiggyBank, category: 'company' },
  BUDGET_REMOVED: { label: 'removed a budget', icon: PiggyBank, category: 'company' },
  BUDGET_ALERT_THRESHOLDS_UPDATED: { label: 'updated budget alert thresholds', icon: PiggyBank, category: 'company' },
  PURCHASE_TEMPLATE_CREATED: { label: 'created a purchase template', icon: ClipboardList, category: 'company' },
  PURCHASE_TEMPLATE_REMOVED: { label: 'removed a purchase template', icon: ClipboardList, category: 'company' },
  RECURRING_PURCHASE_CREATED: { label: 'scheduled a recurring purchase', icon: RefreshCw, category: 'company' },
  RECURRING_PURCHASE_CANCELLED: { label: 'cancelled a recurring purchase', icon: RefreshCw, category: 'company' },
  SUPER_ADMIN_CROSS_COMPANY_READ: { label: 'viewed another company’s data', icon: ShieldAlert, category: 'security' },
};

export function describeActivity(entry: Pick<AuditEntry, 'action'>): ActivityDescription {
  const known = ACTION_DESCRIPTIONS[entry.action];
  if (known) return known;
  return { label: entry.action.replace(/_/g, ' ').toLowerCase(), icon: Building2, category: 'other' };
}

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  role: 'Role changes',
  user: 'User',
  company: 'Company',
  supplier: 'Supplier',
  approval: 'Approvals',
  security: 'Security',
  other: 'Other',
};

export { ActivityIcon };
