/**
 * Dormitoration - Admin Homepage Live Sync Script
 * File: /script/admin_stats.js
 */

document.addEventListener("DOMContentLoaded", () => {
  fetchAdminStats();
});

async function fetchAdminStats() {
  const pendingBadge = document.getElementById("pending-count");
  const occupancyBadge = document.getElementById("occupancy-count");
  const locksBadge = document.getElementById("locks-status");

  try {
    const response = await fetch("/api/admin/stats");
    if (!response.ok) throw new Error("Failed to load admin stats");

    const data = await response.json();

    // Update Pending Applications Badge
    if (pendingBadge) {
      pendingBadge.innerText = data.pending_count ?? 0;
    }

    // Update Room Occupancy Badge
    if (occupancyBadge) {
      if (data.occupancy) {
        occupancyBadge.innerText = `${data.occupancy.occupied} / ${data.occupancy.total} (${data.occupancy.percentage}%)`;
      } else {
        occupancyBadge.innerText = "0 / 600 (0%)";
      }
    }

    // Update Locks Status Badge
    if (locksBadge) {
      locksBadge.innerText = data.locks_status || "Offline";
    }

  } catch (err) {
    console.error("Error fetching stats:", err);
    if (pendingBadge) pendingBadge.innerText = "0";
    if (occupancyBadge) occupancyBadge.innerText = "N/A";
    if (locksBadge) locksBadge.innerText = "Offline";
  }
}