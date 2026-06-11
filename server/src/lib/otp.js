import crypto from "crypto";
import bcrypt from "bcryptjs";

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MS = 10 * 60 * 1000;
export const MAX_VERIFY_ATTEMPTS = 5;
export const MAX_RESEND_PER_HOUR = 5;
/** Time allowed to complete registration after OTP verified */
export const REGISTRATION_WINDOW_MS = 30 * 60 * 1000;
/** Time allowed to set a new password after reset OTP verified */
export const PASSWORD_RESET_WINDOW_MS = 30 * 60 * 1000;

export function generateOtpCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(OTP_LENGTH, "0");
}

export async function hashOtp(otp) {
  return bcrypt.hash(otp, 10);
}

export async function verifyOtp(otp, otpHash) {
  if (!otp || !otpHash) return false;
  return bcrypt.compare(otp, otpHash);
}

export function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}
