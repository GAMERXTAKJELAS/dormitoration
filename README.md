# dormitoration

**Dormitory Monitor Operation System** — a web and smart lock platform built to replace manual hostel paperwork and physical keys at TVETMARA Lumut.

**Live System:** https://dormitoration.syamsulock0457.workers.dev/

---

## What It Does (Overview)
Managing student hostels manually causes long registration queues, lost keys, and unmonitored room access. **DORMITORATION** digitizes the entire workflow into one connected system:

* **Faster Student Check-In:** Replaces paper forms and 30-minute queues with online registration, automated document checks, and automatic room assignment.
* **Keyless Room Entry:** Students unlock doors using their student ID card or a QR code on their phone—eliminating lost or copied keys.
* **Live Hostel Monitoring:** Wardens and staff can view real-time room occupancy, track who enters each room, and unlock doors remotely during emergencies.

---

## How It Is Built (Technical Stack)
For technical reviewers, the system runs on a lightweight, serverless cloud setup connected to physical IoT door hardware:

* **Cloud Backend & Database:** Cloudflare Workers (API), Cloudflare D1 (SQL database), Cloudflare Pages
* **Web Dashboard:** HTML, CSS, JavaScript, jQuery
* **Door Hardware & Firmware:** ESP32 (C++), GM65 QR Scanner, 125kHz RFID Reader, OLED Display, 5V Relay, 12V Magnetic Lock

### Repository Structure
```text
├── admin/                  # Staff & warden dashboard (occupancy, approvals, logs)
├── student/                # Student portal (registration, document upload, QR pass)
├── script/                 # Frontend logic and API integration
├── design/ & image/        # System diagrams and hardware schematics
├── cloudflare_worker.js    # Backend API, database queries, and AI document screening
├── wrangler.json           # Cloud deployment configuration
└── index.html              # Main landing page