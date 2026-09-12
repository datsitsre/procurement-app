import { assertPermission, delay, fail, ok } from './base';
import { allCompanyUsers, allUsers } from './auth.service';
import type { ServiceResult, UUID } from '@/types/common';
import type { CompanyUser, User } from '@/types/company';
import { Permission, type Role } from '@/config/rbac';

export interface TeamMember {
  membership: CompanyUser;
  user: User;
}

export interface CompanyService {
  listTeamMembers(companyId: UUID, callerRole: Role): Promise<ServiceResult<TeamMember[]>>;
}

class MockCompanyService implements CompanyService {
  async listTeamMembers(companyId: UUID, callerRole: Role): Promise<ServiceResult<TeamMember[]>> {
    await delay(250);
    const permissionError = assertPermission(callerRole, Permission.USERS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const members = allCompanyUsers()
      .filter((cu) => cu.companyId === companyId)
      .map((membership) => {
        const user = allUsers().find((u) => u.id === membership.userId);
        return user ? { membership, user } : null;
      })
      .filter((m): m is TeamMember => m !== null);
    return ok(members);
  }
}

export const companyService: CompanyService = new MockCompanyService();
