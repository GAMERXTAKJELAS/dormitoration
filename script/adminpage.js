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
        occupancyBadge.innerText = "0 / 0 (0%)";
      }
    }

    // Update Locks Status Badge
    setLocksBadge(data.locks_status === "Online", data.locks);

  } catch (err) {
    console.error("Error fetching stats:", err);
    if (pendingBadge) pendingBadge.innerText = "0";
    if (occupancyBadge) occupancyBadge.innerText = "N/A";
    setLocksBadge(false, null);
  }
}

// Online = at least one smart lock has reported recently; otherwise Offline.
function setLocksBadge(isOnline, locks) {
  const locksBadge = document.getElementById("locks-status");
  if (!locksBadge) return;
  const card = locksBadge.closest(".stat-badge");
  const icon = card ? card.querySelector("i") : null;

  locksBadge.innerText = isOnline ? "Online" : "Offline";
  if (card) {
    card.classList.toggle("badge-success", isOnline);
    card.classList.toggle("badge-inactive", !isOnline);
    card.title = locks
      ? `${locks.online} of ${locks.total} smart lock(s) online`
      : "Smart lock status unavailable";
  }
  if (icon) {
    icon.classList.toggle("bx-wifi", isOnline);
    icon.classList.toggle("bx-wifi-off", !isOnline);
  }
}