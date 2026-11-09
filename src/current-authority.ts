import { clerkClient } from '@clerk/express';

interface CurrentAuthorityLookup {
  getUser(userId: string): Promise<{ id: string; banned: boolean; locked: boolean }>;
  getMemberships(organizationId: string, userId: string): Promise<Array<{
    organizationId: string;
    userId: string | undefined;
  }>>;
}

const clerkLookup: CurrentAuthorityLookup = {
  async getUser(userId) {
    const user = await clerkClient.users.getUser(userId);
    return { id: user.id, banned: user.banned, locked: user.locked };
  },
  async getMemberships(organizationId, userId) {
    const result = await clerkClient.organizations.getOrganizationMembershipList({
      organizationId,
      userId: [userId],
      limit: 1,
    });
    return result.data.map((membership) => ({
      organizationId: membership.organization.id,
      userId: membership.publicUserData?.userId,
    }));
  },
};

export async function hasCurrentAuthority(
  userId: string,
  organizationId: string,
  lookup: CurrentAuthorityLookup = clerkLookup,
): Promise<boolean> {
  if (!userId || !organizationId) return false;
  try {
    const user = await lookup.getUser(userId);
    if (user.id !== userId || user.banned || user.locked) return false;
    const memberships = await lookup.getMemberships(organizationId, userId);
    return memberships.some(
      (membership) => membership.organizationId === organizationId && membership.userId === userId,
    );
  } catch {
    return false;
  }
}
