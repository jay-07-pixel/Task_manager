/** Users who can open the admin dashboard (includes legacy role=owner). */
export const adminUserWhere = {
  OR: [{ isAdmin: true }, { role: "owner" }],
};

export function userHasAdminAccess(user) {
  return Boolean(user?.isAdmin) || user?.role === "owner";
}
