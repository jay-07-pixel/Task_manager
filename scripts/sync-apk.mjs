import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSrc = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  "AndroidStudioProjects",
  "SugandhReminder",
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk"
);
const src = process.env.APK_SOURCE || defaultSrc;
const dest = path.join(__dirname, "..", "client", "public", "downloads", "sugandh-reminder.apk");

if (!fs.existsSync(src)) {
  console.error(`APK not found: ${src}`);
  console.error("Build the Android app first, or set APK_SOURCE to your .apk path.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
const { size } = fs.statSync(dest);
console.log(`Synced APK (${size} bytes)`);
console.log(`  from: ${src}`);
console.log(`  to:   ${dest}`);
