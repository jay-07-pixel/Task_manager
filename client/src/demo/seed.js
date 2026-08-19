function pad(n) {
  return String(n).padStart(2, "0");
}

function atDay(offsetDays, hour = 12, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function ymd(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function trialWindow() {
  const start = new Date();
  start.setDate(start.getDate() - 12);
  const end = new Date();
  end.setDate(end.getDate() + 18);
  return {
    trialStartDate: new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0).toISOString(),
    trialEndDate: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59).toISOString(),
  };
}

const MUMBAI = { lat: 19.076, lng: 72.8777 };

/**
 * Fresh dummy dataset each page load. Dates are relative to today so dashboards stay populated.
 */
export function createDemoSeed() {
  const trial = trialWindow();

  const owner = {
    id: "u-owner",
    email: "owner@demo.kalpanik.in",
    displayName: "Namra Paun",
    phone: "9876543210",
    role: "employee",
    isAdmin: true,
    isOwner: true,
    salary: 0,
    createdAt: atDay(-90),
  };
  const admin = {
    id: "u-admin",
    email: "admin@demo.kalpanik.in",
    displayName: "ACS Admin",
    phone: "9876543211",
    role: "employee",
    isAdmin: true,
    isOwner: false,
    salary: 45000,
    createdAt: atDay(-80),
  };
  const guna = {
    id: "u-guna",
    email: "guna@demo.kalpanik.in",
    displayName: "Guna",
    phone: "9876543212",
    role: "employee",
    isAdmin: false,
    isOwner: false,
    salary: 18000,
    createdAt: atDay(-60),
  };
  const jaya = {
    id: "u-jaya",
    email: "jayasurya@demo.kalpanik.in",
    displayName: "Jayasurya",
    phone: "9876543213",
    role: "employee",
    isAdmin: false,
    isOwner: false,
    salary: 22000,
    createdAt: atDay(-55),
  };
  const meher = {
    id: "u-meher",
    email: "meher@demo.kalpanik.in",
    displayName: "Meher",
    phone: "9876543214",
    role: "employee",
    isAdmin: false,
    isOwner: false,
    salary: 20000,
    createdAt: atDay(-40),
  };
  const priya = {
    id: "u-priya",
    email: "priya@demo.kalpanik.in",
    displayName: "Priya Shah",
    phone: "9876543215",
    role: "employee",
    isAdmin: false,
    isOwner: false,
    salary: 25000,
    createdAt: atDay(-30),
  };

  const users = [owner, admin, guna, jaya, meher, priya];

  const lists = [
    { id: "list-elite", title: "Prince - Elite", sortOrder: 0, pinned: true, pinnedAt: atDay(-20), kind: "normal" },
    { id: "list-site2", title: "Warehouse - Andheri", sortOrder: 1, pinned: false, pinnedAt: null, kind: "normal" },
    {
      id: "list-emp",
      title: "Employee assignments",
      sortOrder: 99,
      pinned: true,
      pinnedAt: atDay(-90),
      kind: "employee-assignments",
    },
  ];

  const assignments = (rows) =>
    rows.map((r) => ({
      userId: r.userId,
      assignedByUserId: r.assignedByUserId ?? owner.id,
      assigneeDone: r.assigneeDone ?? false,
      submissionText: r.submissionText ?? null,
      proofUrls: r.proofUrls ?? [],
      lastSubmittedAt: r.lastSubmittedAt ?? null,
      lastSubmissionText: r.lastSubmissionText ?? null,
      lastProofUrls: r.lastProofUrls ?? [],
      delegatedAt: r.delegatedAt ?? null,
      progressUpdates: r.progressUpdates ?? [],
    }));

  const tasks = [
    {
      id: "t-site-visit",
      listId: "list-elite",
      createdById: owner.id,
      title: "Site visit — Elite Block B",
      notes: "Photograph shuttering, check steel, upload PDF checklist.",
      dueAt: atDay(0, 17, 0),
      allDay: false,
      dueTimeZone: "Asia/Kolkata",
      recurrence: "none",
      recurrenceRule: null,
      completed: false,
      starred: false,
      highPriority: true,
      durationMinutes: 120,
      reminderBeforeMinutes: 60,
      sortOrder: 0,
      createdAt: atDay(-2),
      assignments: assignments([{ userId: guna.id }, { userId: jaya.id }]),
    },
    {
      id: "t-daily-report",
      listId: "list-elite",
      createdById: admin.id,
      title: "Daily progress report",
      notes: "Submit photos + PDF of today's work.",
      dueAt: atDay(0, 18, 30),
      allDay: false,
      dueTimeZone: "Asia/Kolkata",
      recurrence: "daily",
      recurrenceRule: null,
      completed: false,
      starred: false,
      highPriority: false,
      durationMinutes: 45,
      reminderBeforeMinutes: 30,
      sortOrder: 1,
      createdAt: atDay(-14),
      assignments: assignments([
        {
          userId: meher.id,
          assigneeDone: true,
          submissionText: "Slab photos attached. Concrete pour completed 4:10 PM.",
          lastSubmittedAt: atDay(0, 16, 20),
          proofUrls: ["/api/demo-files/photo-1"],
        },
      ]),
    },
    {
      id: "t-overdue-2",
      listId: "list-elite",
      createdById: owner.id,
      title: "Client snag list follow-up",
      notes: "Close remaining snags from last inspection.",
      dueAt: atDay(-2, 11, 0),
      allDay: false,
      dueTimeZone: "Asia/Kolkata",
      recurrence: "none",
      recurrenceRule: null,
      completed: false,
      starred: false,
      highPriority: false,
      durationMinutes: 90,
      reminderBeforeMinutes: null,
      sortOrder: 2,
      createdAt: atDay(-10),
      assignments: assignments([
        {
          userId: priya.id,
          progressUpdates: [
            {
              id: "pu-1",
              userId: priya.id,
              updateType: "in_progress",
              message: "Waiting on plumber for two bathrooms.",
              createdAt: atDay(-1, 10, 0),
            },
          ],
        },
      ]),
    },
    {
      id: "t-overdue-4",
      listId: "list-site2",
      createdById: admin.id,
      title: "Inventory count — racks 4–7",
      notes: "Count SKUs and upload spreadsheet PDF.",
      dueAt: atDay(-4, 16, 0),
      allDay: false,
      dueTimeZone: "Asia/Kolkata",
      recurrence: "none",
      recurrenceRule: null,
      completed: false,
      starred: false,
      highPriority: false,
      durationMinutes: 180,
      reminderBeforeMinutes: 120,
      sortOrder: 0,
      createdAt: atDay(-12),
      assignments: assignments([{ userId: jaya.id }]),
    },
    {
      id: "t-overdue-8",
      listId: "list-elite",
      createdById: owner.id,
      title: "Safety audit sign-off",
      notes: "Critical: helmets, scaffolding tags, fire extinguisher log.",
      dueAt: atDay(-8, 9, 0),
      allDay: true,
      dueTimeZone: "Asia/Kolkata",
      recurrence: "none",
      recurrenceRule: null,
      completed: false,
      starred: false,
      highPriority: true,
      durationMinutes: 60,
      reminderBeforeMinutes: null,
      sortOrder: 3,
      createdAt: atDay(-20),
      assignments: assignments([{ userId: guna.id }]),
    },
    {
      id: "t-reviewed",
      listId: "list-elite",
      createdById: owner.id,
      title: "Foundation waterproofing",
      notes: "Reviewed and closed.",
      dueAt: atDay(-3, 15, 0),
      allDay: false,
      dueTimeZone: "Asia/Kolkata",
      recurrence: "none",
      recurrenceRule: null,
      completed: true,
      starred: false,
      highPriority: false,
      durationMinutes: 240,
      reminderBeforeMinutes: null,
      sortOrder: 4,
      createdAt: atDay(-15),
      assignments: assignments([
        {
          userId: meher.id,
          assigneeDone: true,
          submissionText: "Membrane photos + warranty PDF.",
          lastSubmittedAt: atDay(-4, 14, 0),
          proofUrls: ["/api/demo-files/photo-1", "/api/demo-files/pdf-1"],
        },
      ]),
    },
    {
      id: "t-weekly",
      listId: "list-site2",
      createdById: admin.id,
      title: "Weekly vendor payment sheet",
      notes: "Attach signed PDF.",
      dueAt: atDay(2, 12, 0),
      allDay: false,
      dueTimeZone: "Asia/Kolkata",
      recurrence: "weekly",
      recurrenceRule: null,
      completed: false,
      starred: false,
      highPriority: false,
      durationMinutes: 30,
      reminderBeforeMinutes: 1440,
      sortOrder: 1,
      createdAt: atDay(-21),
      assignments: assignments([{ userId: priya.id }, { userId: meher.id }]),
    },
    {
      id: "t-peer",
      listId: "list-emp",
      createdById: guna.id,
      title: "Collect material challan from Jayasurya",
      notes: "Peer-assigned pickup.",
      dueAt: atDay(1, 13, 0),
      allDay: false,
      dueTimeZone: "Asia/Kolkata",
      recurrence: "none",
      recurrenceRule: null,
      completed: false,
      starred: false,
      highPriority: false,
      durationMinutes: 40,
      reminderBeforeMinutes: null,
      sortOrder: 0,
      createdAt: atDay(-1),
      assignments: assignments([{ userId: jaya.id, assignedByUserId: guna.id }]),
    },
  ];

  const workLocations = [
    {
      id: "loc-elite",
      name: "Prince Elite site",
      latitude: MUMBAI.lat,
      longitude: MUMBAI.lng,
      radiusMeters: 250,
      isActive: true,
    },
    {
      id: "loc-andheri",
      name: "Andheri warehouse",
      latitude: 19.1197,
      longitude: 72.8464,
      radiusMeters: 180,
      isActive: true,
    },
  ];

  const locationPrefs = {
    [guna.id]: { consentAt: atDay(-20), trackingEnabled: true },
    [jaya.id]: { consentAt: atDay(-18), trackingEnabled: true },
    [meher.id]: { consentAt: atDay(-10), trackingEnabled: true },
    [priya.id]: { consentAt: atDay(-5), trackingEnabled: false },
  };

  const locationPings = {
    [guna.id]: { latitude: MUMBAI.lat + 0.001, longitude: MUMBAI.lng + 0.001, accuracy: 12, recordedAt: atDay(0, 10, 5) },
    [jaya.id]: { latitude: 19.12, longitude: 72.847, accuracy: 18, recordedAt: atDay(0, 9, 40) },
    [meher.id]: { latitude: MUMBAI.lat - 0.002, longitude: MUMBAI.lng, accuracy: 22, recordedAt: atDay(0, 11, 12) },
  };

  const deadlineExtensions = [
    {
      id: "ext-1",
      taskId: "t-overdue-8",
      employeeUserId: guna.id,
      requestedAt: atDay(0, 8, 15),
      status: "pending",
      approvedAt: null,
      approvedByUserId: null,
      newDueAt: null,
    },
  ];

  const dmId = "dm-owner-guna";
  const conversations = [
    { id: dmId, userLowId: owner.id, userHighId: guna.id, updatedAt: atDay(0, 11, 0) },
  ];
  const dmMessages = [
    {
      id: "msg-1",
      conversationId: dmId,
      senderId: guna.id,
      body: "Site photos uploaded. Need you to review Block B shuttering.",
      createdAt: atDay(0, 10, 40),
      readAt: null,
      deletedAt: null,
      attachmentPath: null,
    },
    {
      id: "msg-2",
      conversationId: dmId,
      senderId: owner.id,
      body: "Looks good. Mark the safety audit today.",
      createdAt: atDay(0, 10, 55),
      readAt: atDay(0, 10, 56),
      deletedAt: null,
      attachmentPath: null,
    },
  ];

  const groupId = "grp-site";
  const chatGroups = [
    {
      id: groupId,
      name: "Elite site team",
      createdById: owner.id,
      createdAt: atDay(-30),
      memberIds: [owner.id, admin.id, guna.id, jaya.id, meher.id],
    },
  ];
  const groupMessages = [
    {
      id: "gmsg-1",
      groupId,
      senderId: admin.id,
      body: "Pour starts at 3 PM. Helmets mandatory.",
      createdAt: atDay(0, 9, 0),
      deletedAt: null,
    },
    {
      id: "gmsg-2",
      groupId,
      senderId: meher.id,
      body: "Mixer on the way. ETA 20 min.",
      createdAt: atDay(0, 9, 12),
      deletedAt: null,
    },
  ];

  const attendanceChecks = [
    {
      id: "chk-guna-in",
      userId: guna.id,
      type: "check_in",
      recordedAt: atDay(0, 9, 28),
      workLocationId: "loc-elite",
      withinRadius: true,
      timingStatus: "on_time",
    },
    {
      id: "chk-jaya-in",
      userId: jaya.id,
      type: "check_in",
      recordedAt: atDay(0, 9, 48),
      workLocationId: "loc-andheri",
      withinRadius: true,
      timingStatus: "late",
    },
  ];

  return {
    session: { loggedIn: true, userId: owner.id, role: "owner" },
    users,
    lists,
    tasks,
    workLocations,
    locationPrefs,
    locationPings,
    deadlineExtensions,
    conversations,
    dmMessages,
    chatGroups,
    groupMessages,
    attendanceChecks,
    company: {
      companyName: "Kalpanik Demo Constructions",
      companyAddress: "12, Andheri East, Mumbai 400069",
      companyState: "Maharashtra",
      gstNumber: "27AABCU9603R1ZX",
      gstCertificate: { url: "/api/company/gst-certificate", originalName: "gst-demo.pdf", mimeType: "application/pdf" },
      directorName: "Namra Paun",
      directorEmail: "owner@demo.kalpanik.in",
      directorPhone: "9876543210",
      directorDetails: "Managing director",
      contactPerson2Name: "ACS Admin",
      contactPerson2Email: "admin@demo.kalpanik.in",
      contactPerson2Phone: "9876543211",
      companyProfileComplete: true,
      updatedAt: atDay(-3),
      liveLocationRequired: true,
      attendanceEnabled: true,
      dailyCheckInTime: "09:30",
      dailyCheckOutTime: "18:30",
      attendanceStartDate: ymd(-40),
      ...trial,
    },
    blobs: {},
  };
}
