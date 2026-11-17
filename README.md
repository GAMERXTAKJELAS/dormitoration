# dormitoration

**Dormitory Monitor Operation System** — a web and smart lock platform built to replace manual hostel paperwork and physical keys at TVETMARA Lumut.

- **Live System:** [https://dormitoration.syamsulock0457.workers.dev/](https://dormitoration.syamsulock0457.workers.dev/)
- **ESP32 Hardware Firmware:** [https://github.com/GAMERXTAKJELAS/dormitoration-hardware](https://github.com/GAMERXTAKJELAS/dormitoration-hardware)

---

## What It Does (Overview)
Managing student hostels manually causes long registration queues, lost keys, and unmonitored room access. **DORMITORATION** digitizes the entire workflow into one connected system:

- **Faster Student Check-In:** Replaces paper forms and 30-minute queues with online registration, AI-assisted document screening, and automated room assignment.
- **Keyless Room Entry:** Students unlock their assigned room door using a dynamic QR code on their phone—eliminating lost or copied keys.
- **Live Hostel Monitoring:** Wardens and staff can view real-time room occupancy, track entry logs, detect unusual access activity, and monitor door hardware status.

---

## How It Is Built (Technical Stack)
For technical reviewers, the system runs on a lightweight, serverless cloud setup connected to physical IoT door hardware:

- **Cloud Backend & Database:** Cloudflare Workers (Edge API & Cron), Cloudflare D1 (SQLite), Cloudflare R2 (Object Storage), Cloudflare Workers AI
- **Web Dashboard:** HTML, CSS, JavaScript, jQuery (hosted on Cloudflare Assets/Pages)
- **Door Hardware & Firmware:** ESP32 (C++), GM65 QR Scanner, SSD1306 OLED Display, 5V Relay, 12V Electromagnetic Lock, LM2596 Buck Converter

### Repository Structure
```text
├── admin/                  # Staff & warden dashboard (occupancy, approvals, analytics, logs)
├── student/                # Student portal (registration, document upload, QR access pass)
├── script/                 # Frontend logic and API integration
├── design/ & image/        # System diagrams and hardware schematics
├── cloudflare_worker.js    # Edge API, D1 queries, R2 uploads, and AI document screening
├── wrangler.json           # Cloudflare Workers, D1, R2, AI, and Cron configuration
└── index.html              # Main landing page
```

---

## Quick UI Preview
To test the dashboard interface locally in a browser console without backend credentials:
```javascript
localStorage.setItem('isLoggedIn', 'true');
```

---

## Recognition
- **Bronze Medal** — New Generation World Innovation Challenges (NEWIC 2026)

## Team
- Muhammad Syamsul Nazir Bin Mohd Samsuri
- Najjwa Aqilla Binti Mohd Khairi