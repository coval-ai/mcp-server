import { jest } from '@jest/globals';
import { hasCurrentAuthority } from '../../src/current-authority.js';

const userId = 'user_123';
const organizationId = 'org_123';

function lookup(options: {
  banned?: boolean;
  locked?: boolean;
  userId?: string;
  membershipUserId?: string;
  membershipOrganizationId?: string;
  fail?: boolean;
} = {}) {
  return {
    getUser: jest.fn(async () => {
      if (options.fail) throw new Error('Clerk unavailable');
      return { id: options.userId ?? userId, banned: options.banned ?? false, locked: options.locked ?? false };
    }),
    getMemberships: jest.fn(async () => [{
      organizationId: options.membershipOrganizationId ?? organizationId,
      userId: options.membershipUserId ?? userId,
    }]),
  };
}

describe('current hosted OAuth authority', () => {
  it('accepts only the current unbanned user and selected-organization membership', async () => {
    const source = lookup();
    await expect(hasCurrentAuthority(userId, organizationId, source)).resolves.toBe(true);
    expect(source.getMemberships).toHaveBeenCalledWith(organizationId, userId);
  });

  it.each([
    ['banned user', { banned: true }],
    ['locked user', { locked: true }],
    ['different user', { userId: 'user_other' }],
  ])('denies %s before membership lookup', async (_name, options) => {
    const source = lookup(options);
    await expect(hasCurrentAuthority(userId, organizationId, source)).resolves.toBe(false);
    expect(source.getMemberships).not.toHaveBeenCalled();
  });

  it.each([
    ['membership removal', { membershipUserId: 'user_other' }],
    ['wrong organization', { membershipOrganizationId: 'org_other' }],
  ])('denies %s', async (_name, options) => {
    await expect(hasCurrentAuthority(userId, organizationId, lookup(options))).resolves.toBe(false);
  });

  it('fails closed when Clerk is unavailable', async () => {
    await expect(hasCurrentAuthority(userId, organizationId, lookup({ fail: true }))).resolves.toBe(false);
  });

  it('rejects a previously accepted identity after a ban', async () => {
    let banned = false;
    const source = {
      getUser: jest.fn(async () => ({ id: userId, banned, locked: false })),
      getMemberships: jest.fn(async () => [{ organizationId, userId }]),
    };
    await expect(hasCurrentAuthority(userId, organizationId, source)).resolves.toBe(true);
    banned = true;
    await expect(hasCurrentAuthority(userId, organizationId, source)).resolves.toBe(false);
    expect(source.getUser).toHaveBeenCalledTimes(2);
    expect(source.getMemberships).toHaveBeenCalledTimes(1);
  });
});
