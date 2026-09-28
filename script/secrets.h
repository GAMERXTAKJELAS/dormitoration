#pragma once
// =====================================================================
//  include/secrets.h  -  PLACEHOLDERS. Add this file to .gitignore!
// =====================================================================

// ---- WiFi (secret) ----
#define WIFI_SSID       "hahahaha"
#define WIFI_PASSWORD   "iTSH1DD3N"

// ---- Website endpoint (not secret, but environment-specific) ----
#define API_URL         "https://dormitoration.syamsulock0457.workers.dev"

// ---- Device identity ----
#define DEVICE_ID       "door-1"

// ---- Shared key: must match the Worker's DEVICE_API_KEY secret (secret) ----
#define DEVICE_API_KEY  "9856e400-b2f4-495d-a12f-7935fe5c0072"

// ---- Only needed when USE_INSECURE_TLS is false in main.cpp ----
static const char ROOT_CA[] = R"EOF(
-----BEGIN CERTIFICATE-----
PASTE_ROOT_CA_HERE
-----END CERTIFICATE-----
)EOF";
