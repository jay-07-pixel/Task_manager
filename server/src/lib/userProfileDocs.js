import { prisma } from "./prisma.js";

export const USER_PROFILE_DOC_MAX_BYTES = 10 * 1024 * 1024;

export const profileDocumentSelect = {
  profilePhotoPath: true,
  profilePhotoMime: true,
  profilePhotoName: true,
  idProofPath: true,
  idProofMime: true,
  idProofName: true,
};

function docPayload(path, name, url) {
  if (!path) return null;
  return {
    url,
    originalName: name ?? url.split("/").pop(),
  };
}

export function appendProfileDocuments(profile, user, docUserId = null) {
  const base = docUserId ? `/api/users/${docUserId}` : "/api/users";
  profile.profilePhoto = docPayload(user.profilePhotoPath, user.profilePhotoName, `${base}/profile-photo`);
  profile.idProof = docPayload(user.idProofPath, user.idProofName, `${base}/id-proof`);
  profile.profileDocumentsComplete = Boolean(user.profilePhotoPath && user.idProofPath);
  return profile;
}

export async function setUserProfilePhoto(userId, { storedName, mimeType, originalName }) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      profilePhotoPath: storedName,
      profilePhotoMime: mimeType,
      profilePhotoName: originalName,
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      phone: true,
      salary: true,
      role: true,
      isAdmin: true,
      isOwner: true,
      createdAt: true,
      ...profileDocumentSelect,
    },
  });
}

export async function clearUserProfilePhoto(userId) {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { profilePhotoPath: true },
  });
  return {
    row,
    user: await prisma.user.update({
      where: { id: userId },
      data: {
        profilePhotoPath: null,
        profilePhotoMime: null,
        profilePhotoName: null,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        phone: true,
        salary: true,
        role: true,
        isAdmin: true,
        isOwner: true,
        createdAt: true,
        ...profileDocumentSelect,
      },
    }),
  };
}

export async function setUserIdProof(userId, { storedName, mimeType, originalName }) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      idProofPath: storedName,
      idProofMime: mimeType,
      idProofName: originalName,
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      phone: true,
      salary: true,
      role: true,
      isAdmin: true,
      isOwner: true,
      createdAt: true,
      ...profileDocumentSelect,
    },
  });
}

export async function clearUserIdProof(userId) {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { idProofPath: true },
  });
  return {
    row,
    user: await prisma.user.update({
      where: { id: userId },
      data: {
        idProofPath: null,
        idProofMime: null,
        idProofName: null,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        phone: true,
        salary: true,
        role: true,
        isAdmin: true,
        isOwner: true,
        createdAt: true,
        ...profileDocumentSelect,
      },
    }),
  };
}
