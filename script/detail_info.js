document.addEventListener('DOMContentLoaded', async () => {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');

    // Pre-fill existing data
    if (userData.full_name) document.getElementById('full_name').value = userData.full_name;
    if (userData.phone) document.getElementById('phone').value = userData.phone;
    if (userData.ic_number) document.getElementById('ic_number').value = userData.ic_number;
    if (userData.student_id) document.getElementById('student_id').value = userData.student_id;
    if (userData.course_name) document.getElementById('course_name').value = userData.course_name;
    if (userData.gender) document.getElementById('gender').value = userData.gender;
    if (userData.semester) document.getElementById('semester').value = userData.semester;
    if (userData.guardian_name) document.getElementById('guardian_name').value = userData.guardian_name;
    if (userData.guardian_phone) document.getElementById('guardian_phone').value = userData.guardian_phone;

    const detailForm = document.getElementById('detailInfoForm');
    const msgDiv = document.getElementById('detailMsg');

    detailForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        msgDiv.style.color = '#ffffff';
        msgDiv.innerText = 'Saving details...';

        const updatedDetails = {
            full_name: document.getElementById('full_name').value.trim(),
            ic_number: document.getElementById('ic_number').value.trim(),
            gender: document.getElementById('gender').value,
            student_id: document.getElementById('student_id').value.trim(),
            course_name: document.getElementById('course_name').value.trim(),
            semester: document.getElementById('semester').value,
            phone: document.getElementById('phone').value.trim(),
            guardian_name: document.getElementById('guardian_name').value.trim(),
            guardian_phone: document.getElementById('guardian_phone').value.trim()
        };

        try {
            const response = await fetch('/api/student/update-details', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: userData.username,
                    ...updatedDetails
                })
            });

            if (response.ok) {
                // Merge into local storage session data
                const newUserData = { ...userData, ...updatedDetails };
                localStorage.setItem('userData', JSON.stringify(newUserData));

                msgDiv.style.color = '#47f59b';
                msgDiv.innerText = 'Details saved successfully! Redirecting...';

                setTimeout(() => {
                    window.location.href = '/student/studenthomepage.html';
                }, 1000);
            } else {
                const err = await response.json();
                msgDiv.style.color = '#ff6b6b';
                msgDiv.innerText = err.error || 'Failed to update details.';
            }
        } catch (err) {
            console.error(err);
            msgDiv.style.color = '#ff6b6b';
            msgDiv.innerText = 'Server connection error.';
        }
    });
});