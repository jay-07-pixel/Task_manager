/** Users who can open the admin dashboard (includes legacy role=owner). */
export const adminUserWhere = {
  OR: [{ isAdmin: true }, { role: "owner" }],
};

export const companyOwnerWhere = {
  isOwner: true,
};

export const MAX_COMPANY_OWNERS = 2;

export function userHasAdminAccess(user) {
  return Boolean(user?.isAdmin) || user?.role === "owner" || Boolean(user?.isOwner);
}

/** Company owners: Owner dashboard + promote/revoke owners (max 2). */
export function userIsCompanyOwner(user) {
  return Boolean(user?.isOwner);
}
