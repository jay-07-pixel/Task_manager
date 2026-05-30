import 'dotenv/config';
import { PrismaClient } from "../prisma-client/index.js";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const owner = await prisma.user.upsert({
    where: { email: "owner@local.test" },
    update: { phone: "5550100100" },
    create: {
      email: "owner@local.test",
      passwordHash,
      displayName: "Owner User",
      phone: "5550100100",
      role: "owner",
    },
  });

  const emp1 = await prisma.user.upsert({
    where: { email: "employee1@local.test" },
    update: { phone: "5550100101" },
    create: {
      email: "employee1@local.test",
      passwordHash,
      displayName: "Employee One",
      phone: "5550100101",
      role: "employee",
    },
  });

  const emp2 = await prisma.user.upsert({
    where: { email: "employee2@local.test" },
    update: { phone: "5550100102" },
    create: {
      email: "employee2@local.test",
      passwordHash,
      displayName: "Employee Two",
      phone: "5550100102",
      role: "employee",
    },
  });

  const listCount = await prisma.taskList.count({ where: { ownerId: owner.id } });
  if (listCount === 0) {
    const list = await prisma.taskList.create({
      data: {
        ownerId: owner.id,
        title: "My Tasks",
        sortOrder: 0,
      },
    });
    const todayNoon = new Date();
    todayNoon.setUTCHours(12, 0, 0, 0);
    await prisma.task.create({
      data: {
        listId: list.id,
        createdById: owner.id,
        title: "Sample task",
        notes: "Open the detail panel to add notes and a due date.",
        sortOrder: 0,
        recurrence: "daily",
        dueAt: todayNoon,
        allDay: true,
        assignments: { create: [{ userId: emp1.id }] },
      },
    });
  }

  console.log("Seed OK:", { owner: owner.email, emp1: emp1.email, emp2: emp2.email });
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
