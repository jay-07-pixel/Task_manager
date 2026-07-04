/** @readonly Kalpanik Task Manager & Reminder — Privacy Policy and Terms & Conditions */
export const LEGAL_ANNOUNCEMENT_ID = "legal-privacy-terms-20260603";

export const PRIVACY_TERMS_META = {
  title: "Kalpanik Task Manager & Kalpanik Reminder",
  subtitle: "Privacy Policy and Terms & Conditions",
  effectiveDate: "3 June 2026",
  operator: "Kalpanik",
  supportEmail: "support@kalpanik.in",
};

/** @type {{ id: string; title: string; paragraphs?: string[]; bullets?: string[] }[]} */
export const PRIVACY_TERMS_SECTIONS = [
  {
    id: "overview",
    title: "1. Overview",
    paragraphs: [
      "This document summarizes the Privacy Policy and Terms & Conditions applicable to the Kalpanik Task Manager web platform and Kalpanik Reminder Android application. By using the software, organizations, administrators, owners, and employees agree to these terms.",
    ],
  },
  {
    id: "privacy",
    title: "2. Privacy Policy",
    bullets: [
      "We collect account details (name, email, phone), authentication information, task data, chat messages, uploaded files, attendance records, and device information.",
      "When enabled by the employer, precise GPS location is collected for attendance and live workforce management. Location is visible only to authorized administrators of the customer's organization.",
      "Uploaded images, videos, PDFs, voice notes, chats, and task submissions are processed solely for business collaboration and task management.",
      "We use trusted third-party services including Firebase Cloud Messaging, Google Maps/Geocoding, Brevo email services, Cloudflare Turnstile, and secure hosting providers.",
      "Passwords are securely encrypted. We implement reasonable technical and organizational safeguards to protect information.",
      "Each customer has an isolated deployment with separate databases and storage. Data is not shared across customer organizations.",
      "Users may request correction or deletion of data through their employer or Kalpanik support, subject to legal and contractual obligations.",
    ],
  },
  {
    id: "terms",
    title: "3. Terms & Conditions",
    bullets: [
      "The platform is intended solely for authorized business use.",
      "Registration creates an employee account; administrative privileges are granted only by authorized company owners or administrators.",
      "Employees are responsible for maintaining account confidentiality and using the software only for legitimate work purposes.",
      "When an employer requires attendance tracking, disabling mandatory location services may limit access to application features.",
      "Users must not upload illegal, harmful, or infringing content or attempt unauthorized access.",
      "Organizations remain responsible for ensuring compliance with employment laws and obtaining any required employee notices or consents.",
      "Kalpanik retains all intellectual property rights in the software.",
      "The service is provided on an 'as available' basis. Kalpanik is not liable for indirect or consequential damages to the maximum extent permitted by law.",
      "These terms may be updated periodically. Continued use indicates acceptance of the revised terms.",
    ],
  },
  {
    id: "contact",
    title: "4. Contact",
    paragraphs: ["For privacy requests or support, contact: support@kalpanik.in"],
  },
];
