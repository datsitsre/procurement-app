import { apiRequest } from './base';
import type { ServiceResult, UUID } from '@/types/common';
import type { Role } from '@/config/rbac';

export interface InvitationPreview {
  companyName: string;
  role: Role;
  email: string;
  name?: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  isExistingAccount: boolean;
}

export interface AcceptInvitationInput {
  token: string;
  password?: string;
  name?: string;
}

/** The public /accept-invitation page's data source - unauthenticated, since the person hasn't
 *  signed in yet (or, for an existing account, doesn't need to). */
export const invitationService = {
  getPreview(token: string): Promise<ServiceResult<InvitationPreview>> {
    return apiRequest<InvitationPreview>(`/api/invitations/${token}`);
  },
  accept(input: AcceptInvitationInput): Promise<ServiceResult<{ userId: UUID; companyId: UUID }>> {
    return apiRequest<{ userId: UUID; companyId: UUID }>('/api/invitations/accept', { method: 'POST', body: JSON.stringify(input) });
  },
};
