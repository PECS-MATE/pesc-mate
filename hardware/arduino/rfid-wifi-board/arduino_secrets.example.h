#pragma once
// Copy to arduino_secrets.h locally. That file is ignored by Git.
#define SECRET_SSID "YOUR_PRIVATE_WIFI"
#define SECRET_PASS "YOUR_WIFI_PASSWORD"
#define SECRET_DEVICE_ID "pecsmate-01"
#define SECRET_DEVICE_KEY "PASTE_THE_ONCE_SHOWN_DEVICE_KEY_HERE"
#define SECRET_API_HOST "192.168.0.10"
#define SECRET_API_PORT 8000
#define SECRET_USE_TLS 0
// Set to 1 ONLY on a trusted private LAN with compose.rfid.yaml.
#define SECRET_ALLOW_INSECURE_LAN 0
// Test 1, then 2, then 3. Unconfigured positions report ERROR, not EMPTY.
#define RFID_READER_COUNT 3
#define RFID_DEBUG_UIDS 0
