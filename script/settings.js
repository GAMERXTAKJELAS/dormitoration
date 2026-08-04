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

                if (res.ok) {
                    alert("Default registration window updated successfully!");
                } else {
                    alert("Failed to save setting.");
                }
            } catch (err) {
                console.error("Error saving deadline setting:", err);
            }
        });
    }

    loadDeadlineSetting();
});