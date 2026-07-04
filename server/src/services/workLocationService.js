import { prisma } from "../lib/prisma.js";

function serializeWorkLocation(row) {
  return {
    id: row.id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusMeters: row.radiusMeters,
    coordinates: `${row.latitude}, ${row.longitude}`,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listWorkLocations({ activeOnly = false } = {}) {
  const rows = await prisma.workLocation.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return rows.map(serializeWorkLocation);
}

export async function createWorkLocation(data) {
  const row = await prisma.workLocation.create({
    data: {
      name: data.name.trim(),
      latitude: data.latitude,
      longitude: data.longitude,
      radiusMeters: data.radiusMeters,
      isActive: data.isActive ?? true,
    },
  });
  return serializeWorkLocation(row);
}

export async function updateWorkLocation(id, data) {
  const existing = await prisma.workLocation.findUnique({ where: { id } });
  if (!existing) return null;
  const row = await prisma.workLocation.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
      ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
      ...(data.radiusMeters !== undefined ? { radiusMeters: data.radiusMeters } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });
  return serializeWorkLocation(row);
}

export async function deleteWorkLocation(id) {
  const existing = await prisma.workLocation.findUnique({ where: { id } });
  if (!existing) return false;
  await prisma.workLocation.delete({ where: { id } });
  return true;
}

export async function getActiveWorkLocations() {
  return prisma.workLocation.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
}
