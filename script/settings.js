document.addEventListener("DOMContentLoaded", () => {
    const valueInput = document.getElementById("deadline-value");
    const unitSelect = document.getElementById("deadline-unit");
    const saveBtn = document.getElementById("save-deadline-btn");

    // Fetch existing global setting from D1
    async function loadDeadlineSetting() {
        try {
            const res = await fetch("/api/admin/settings/deadline");
            if (res.ok) {
                const data = await res.json();
                if (data.value && data.unit) {
                    valueInput.value = data.value;
                    unitSelect.value = data.unit;
                }
            }
        } catch (err) {
            console.error("Error loading deadline setting:", err);
        }
    }

    // Save global default deadline
    if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
            const val = parseInt(valueInput.value, 10);
            const unit = unitSelect.value;

            if (!val || val < 1) {
                alert("Please enter a valid duration.");
                return;
            }

            try {
                const res = await fetch("/api/admin/settings/deadline", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ value: val, unit: unit })
                });

                const data = await res.json();

                if (res.ok) {
                    alert("Default registration window updated successfully!");
                } else {
                    // Show exact server error if available
                    alert(`Failed to save setting: ${data.details || data.error || 'Unknown server error'}`);
                }
            } catch (err) {
                console.error("Error saving deadline setting:", err);
                alert(`Network error: ${err.message}`);
            }
        });
    }

    // ---------- Unusual hours windows (anomaly rule used by the Data Visualize page) ----------
    const windowList = document.getElementById("anomaly-windows");
    const anomalyMsg = document.getElementById("anomaly-msg");
    const defaultNote = document.getElementById("anomaly-default-note");
    const addWindowBtn = document.getElementById("anomaly-add-btn");
    const resetWindowsBtn = document.getElementById("anomaly-reset-btn");
    const saveWindowsBtn = document.getElementById("anomaly-save-btn");
    let maxWindows = 5;

    function getAdminId() {
        try {
            const u = JSON.parse(localStorage.getItem("userData") || "{}");
            return u.id || u.user_id || null;
        } catch (e) {
            return null;
        }
    }

    function showAnomalyMsg(text, kind) {
        anomalyMsg.textContent = text || "";
        anomalyMsg.className = "setting-msg" + (kind ? " " + kind : "");
    }

    function updateAddState() {
        addWindowBtn.disabled = windowList.children.length >= maxWindows;
    }

    function timeInput(value, label) {
        const input = document.createElement("input");
        input.type = "time";
        input.className = "setting-input window-time";
        input.value = value || "";
        input.setAttribute("aria-label", label);
        return input;
    }

    function addWindowRow(start, end) {
        const row = document.createElement("div");
        row.className = "window-row";

        const sep = document.createElement("span");
        sep.className = "window-sep";
        sep.textContent = "to";

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn-icon-remove";
        remove.title = "Remove this window";
        remove.innerHTML = "<i class='bx bx-x'></i>";
        remove.addEventListener("click", () => {
            row.remove();
            updateAddState();
        });

        row.append(timeInput(start, "Window start"), sep, timeInput(end, "Window end"), remove);
        windowList.appendChild(row);
    }

    function renderWindows(windows, isDefault) {
        windowList.innerHTML = "";
        windows.forEach(w => addWindowRow(w.start, w.end));
        if (isDefault) {
            const text = windows.map(w => w.start + " to " + w.end).join(", ");
            defaultNote.textContent = "No custom window is saved, so the default (" + text + ") is in use. Press Save to keep your own.";
            defaultNote.style.display = "";
        } else {
            defaultNote.style.display = "none";
        }
        updateAddState();
    }

    // Reads the rows into [{start, end}], or returns { error } if something is not filled in properly
    function collectWindows() {
        const windows = [];
        for (const row of windowList.children) {
            const [from, to] = row.querySelectorAll("input");
            if (!from.value || !to.value) return { error: "Fill in both times for every window, or remove the empty one." };
            if (from.value === to.value) return { error: "A window cannot start and end at the same time." };
            windows.push({ start: from.value, end: to.value });
        }
        return { windows };
    }

    async function sendWindows(windows) {
        const adminId = getAdminId();
        if (!adminId) {
            showAnomalyMsg("Please log in as an admin first.", "error");
            return null;
        }
        saveWindowsBtn.disabled = true;
        resetWindowsBtn.disabled = true;
        try {
            const res = await fetch("/api/admin/settings/anomaly-hours", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ admin_id: adminId, windows: windows })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showAnomalyMsg(data.error || "Could not save (error " + res.status + ").", "error");
                return null;
            }
            maxWindows = data.max_windows || maxWindows;
            renderWindows(data.windows, data.is_default);
            return data;
        } catch (err) {
            showAnomalyMsg("Network error: " + err.message, "error");
            return null;
        } finally {
            saveWindowsBtn.disabled = false;
            resetWindowsBtn.disabled = false;
        }
    }

    async function loadAnomalyWindows() {
        const adminId = getAdminId();
        if (!adminId) {
            showAnomalyMsg("Please log in as an admin to see this setting.", "error");
            return;
        }
        try {
            const res = await fetch("/api/admin/settings/anomaly-hours?admin_id=" + encodeURIComponent(adminId));
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showAnomalyMsg(data.error || "Could not load this setting (error " + res.status + ").", "error");
                return;
            }
            maxWindows = data.max_windows || maxWindows;
            renderWindows(data.windows, data.is_default);
        } catch (err) {
            showAnomalyMsg("Network error: " + err.message, "error");
        }
    }

    if (windowList) {
        addWindowBtn.addEventListener("click", () => {
            addWindowRow("", "");
            updateAddState();
            showAnomalyMsg("");
        });

        saveWindowsBtn.addEventListener("click", async () => {
            const picked = collectWindows();
            if (picked.error) {
                showAnomalyMsg(picked.error, "error");
                return;
            }
            const data = await sendWindows(picked.windows);
            if (data) {
                showAnomalyMsg(
                    data.is_default
                        ? "No windows left, so the default is in use."
                        : "Saved. The Data Visualize page uses these windows from now on.",
                    "ok"
                );
            }
        });

        resetWindowsBtn.addEventListener("click", async () => {
            const data = await sendWindows([]);
            if (data) showAnomalyMsg("Back to the default window.", "ok");
        });

        loadAnomalyWindows();
    }

    loadDeadlineSetting();
});