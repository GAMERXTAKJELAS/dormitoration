// access_code_utils.js
// Shared lifecycle rule for the student QR "unique access code".
// Default validity window: 6 months from issuance (student_rfid.assigned_at).
// `validityMonths` is a parameter (not hardcoded) so it can later be driven by
// an admin-configurable setting (e.g. system_settings.setting_key = 'qr_validity_months')
// without touching this function's logic again.
// NOTE: This is completely separate from the room passcode's own cycle —
// a student's room code keeps working after the QR access code expires.

export function isAccessCodeExpired(assignedAtRaw, validityMonths = 6) {
  if (!assignedAtRaw) return false;

  const assigned = new Date(String(assignedAtRaw).replace(' ', 'T'));
  if (isNaN(assigned.getTime())) return false;

  const expiry = new Date(assigned);
  expiry.setMonth(expiry.getMonth() + validityMonths);

  return new Date() >= expiry;
}