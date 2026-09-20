// access_code_utils.js
// Shared lifecycle rule for the student QR "unique access code".
// Validity window: 5 months + 2 weeks from issuance (student_rfid.assigned_at).
// NOTE: This is completely separate from the room passcode's own 6-month cycle —
// a student's room code keeps working after the QR access code expires.

export function isAccessCodeExpired(createdAtRaw) {
  if (!createdAtRaw) return false;

  const created = new Date(String(createdAtRaw).replace(' ', 'T'));
  if (isNaN(created.getTime())) return false;

  const expiry = new Date(created);
  expiry.setMonth(expiry.getMonth() + 5);
  expiry.setDate(expiry.getDate() + 14); // + 2 weeks

  return new Date() >= expiry;
}
