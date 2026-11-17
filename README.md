# dormitoration

Dormitory Monitor Operation System — an IoT access control and hostel management web application built for TVETMARA Lumut.

**Live Demo:** https://dormitoration.syamsulock0457.workers.dev/

---

## Overview
A lightweight, serverless platform that digitizes hostel room registration, occupancy tracking, and door access. It pairs an ESP32 smart lock controller with a Cloudflare Workers API and Cloudflare D1 SQL database.

### Core Functions
* **Door Access:** Keyless entry via student RFID cards and dynamic QR codes (GM65 optical scanner).
* **Room Management:** Online student registration, automated room allocation, and live occupancy status.
* **Admin Dashboard:** Access logs, AI-assisted document verification, and remote door overrides.

---

## Tech Stack
* **Backend & Database:** Cloudflare Workers, Cloudflare D1 (SQLite), Wrangler CLI
* **Frontend:** HTML, CSS, JavaScript, jQuery (hosted on Cloudflare Pages)
* **Hardware / Firmware:** ESP32 (C++), GM65 QR Scanner, 125kHz RFID Reader, OLED Display, 5V Relay, 12V Electromagnetic Lock

---

## Repository Structure
```text
├── admin/                  # Admin dashboard views
├── student/                # Student portal views
├── script/                 # Frontend scripts and API calls
├── design/ & image/        # Schematics and assets
├── cloudflare_worker.js    # Edge API & D1 database logic
├── wrangler.json           # Cloudflare configuration
└── index.html              # Entry point