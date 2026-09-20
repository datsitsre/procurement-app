import { describe, expect, it } from 'vitest';
import { describeActivity } from './activityFeed';

describe('describeActivity (Activity Center - section 4/16)', () => {
  it('maps a real, known audit action to a friendly label and category', () => {
    const result = describeActivity({ action: 'TEAM_MEMBER_ROLE_CHANGED' });
    expect(result.label).toBe("changed a team member's role");
    expect(result.category).toBe('role');
  });

  it('maps SUPER_ADMIN_CROSS_COMPANY_READ to the security category, distinct from ordinary activity', () => {
    const result = describeActivity({ action: 'SUPER_ADMIN_CROSS_COMPANY_READ' });
    expect(result.category).toBe('security');
  });

  it('never hides an unrecognized action - falls back to a humanized version of the raw code', () => {
    const result = describeActivity({ action: 'SOME_FUTURE_ACTION_TYPE' });
    expect(result.label).toBe('some future action type');
    expect(result.category).toBe('other');
  });
});
