import { createDemoSeed } from "./seed.js";

/** @type {ReturnType<typeof createDemoSeed> | null} */
let store = null;

export function getDemoStore() {
  if (!store) store = createDemoSeed();
  return store;
}

export function resetDemoStore() {
  store = createDemoSeed();
  return store;
}

export function demoNowIso() {
  return new Date().toISOString();
}

export function demoId(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function sessionUserPayload(store, user, activeRole) {
  const company = store.company;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    phone: user.phone,
    isAdmin: Boolean(user.isAdmin || user.isOwner),
    isOwner: Boolean(user.isOwner),
    role: activeRole,
    liveLocationRequired: company.liveLocationRequired !== false,
    attendanceEnabled: company.attendanceEnabled === true,
  };
}

export function currentDemoUser(store) {
  if (!store.session.loggedIn) return null;
  return store.users.find((u) => u.id === store.session.userId) ?? null;
}
