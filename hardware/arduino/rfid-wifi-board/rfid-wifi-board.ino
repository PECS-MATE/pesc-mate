// UNO R4 WiFi / MFRC522 / WiFiS3. Actual three-reader electrical/RF tests are required.
#include <SPI.h>
#include <MFRC522.h>
#include <WiFiS3.h>
#include "arduino_secrets.h"

#if RFID_READER_COUNT < 1 || RFID_READER_COUNT > 3
#error "RFID_READER_COUNT must be 1, 2 or 3"
#endif
#if !SECRET_USE_TLS && !SECRET_ALLOW_INSECURE_LAN
#error "Use TLS, or explicitly opt into trusted-LAN HTTP in the local secrets file"
#endif

const byte SS_PINS[3] = {10, 8, 7};
const byte RST_PINS[3] = {9, 6, 5};
MFRC522 readers[3];
struct Slot {
  String uid, candidate;
  const char *status = "ERROR";
  byte confirmations = 0, misses = 0;
  unsigned long lastSeen = 0;
};
Slot slots[3];
const unsigned long POLL_MS = 100, REMOVE_MS = 1200, HEARTBEAT_MS = 5000;
unsigned long lastPoll = 0, lastFrame = 0, lastNetwork = 0, retryMs = 1000;
uint32_t sequence = 0;
String sessionId, pendingBody;
bool dirty = true;
int lastHttpError = 0;

void setSlot(byte index, const char *status, const String &uid = "") {
  Slot &slot = slots[index];
  if (slot.uid == uid && strcmp(slot.status, status) == 0) return;
  slot.uid = uid; slot.status = status; dirty = true;
  Serial.print("Reader "); Serial.print(index + 1); Serial.print(": "); Serial.println(status);
#if RFID_DEBUG_UIDS
  // Development only. Never commit recorded real UID-to-child mappings.
  if (uid.length()) Serial.println(uid);
#endif
}

void pollReaders() {
  for (byte index = 0; index < RFID_READER_COUNT; ++index) {
    MFRC522 &reader = readers[index]; Slot &slot = slots[index];
    // Only one RF field is enabled during each read; this does not fix bad MISO tri-state hardware.
    reader.PCD_AntennaOn(); delay(5);
    byte atqa[2], atqaSize = sizeof(atqa);
    MFRC522::StatusCode result = reader.PICC_WakeupA(atqa, &atqaSize);
    bool present = (result == MFRC522::STATUS_OK || result == MFRC522::STATUS_COLLISION)
      && reader.PICC_ReadCardSerial();
    if (present) {
      String uid;
      for (byte part = 0; part < reader.uid.size; ++part) {
        if (reader.uid.uidByte[part] < 16) uid += '0';
        uid += String(reader.uid.uidByte[part], HEX);
      }
      uid.toUpperCase(); slot.lastSeen = millis(); slot.misses = 0;
      if (slot.candidate == uid) { if (slot.confirmations < 2) slot.confirmations++; }
      else { slot.candidate = uid; slot.confirmations = 1; }
      if (slot.confirmations >= 2) setSlot(index, "PRESENT", uid);
      reader.PICC_HaltA(); reader.PCD_StopCrypto1();
    } else {
      slot.confirmations = 0; slot.candidate = "";
      byte version = reader.PCD_ReadRegister(MFRC522::VersionReg);
      // Unknown but responsive versions, including 0x82, are not rejected.
      if (version == 0 || version == 255 || (result != MFRC522::STATUS_TIMEOUT
          && millis() - slot.lastSeen >= REMOVE_MS)) {
        setSlot(index, "ERROR");
      } else if (result == MFRC522::STATUS_TIMEOUT) {
        if (slot.misses < 255) slot.misses++;
        if (slot.misses >= 4 && millis() - slot.lastSeen >= REMOVE_MS) setSlot(index, "EMPTY");
      }
    }
    reader.PCD_AntennaOff();
  }
}

String makeSnapshot() {
  ++sequence;
  String body = "{\"protocol_version\":1,\"session_id\":\"" + sessionId
    + "\",\"event_id\":" + String(sequence) + ",\"readers\":[";
  for (byte index = 0; index < 3; ++index) {
    if (index) body += ',';
    bool ambiguous = false;
    for (byte other = 0; other < 3; other++) if (index != other && slots[index].uid.length()
        && slots[index].uid == slots[other].uid) ambiguous = true;
    body += "{\"reader_id\":" + String(index + 1) + ",\"status\":\"" + (ambiguous ? "ERROR" : slots[index].status) + "\",\"uid\":";
    body += slots[index].uid.length() && !ambiguous ? "\"" + slots[index].uid + "\"" : "null";
    body += '}';
  }
  return body + "]}";
}

bool validConfiguration() {
  String id = SECRET_DEVICE_ID, host = SECRET_API_HOST, key = SECRET_DEVICE_KEY;
  if (!id.length() || id.length() > 64 || key.length() < 32 || key.indexOf("PASTE_") == 0) return false;
  for (unsigned int i = 0; i < id.length(); i++) if (!isalnum(id[i]) && id[i] != '-' && id[i] != '_') return false;
  for (unsigned int i = 0; i < host.length(); i++) if (!isalnum(host[i]) && host[i] != '.' && host[i] != '-') return false;
  for (unsigned int i = 0; i < key.length(); i++) if (!isalnum(key[i]) && key[i] != '-' && key[i] != '_') return false;
  return host.length() > 0;
}

int post(const String &suffix, const String &body, String &newSession) {
#if SECRET_USE_TLS
  WiFiSSLClient client; // Use the WiFiS3 trust store; never disable certificate validation.
#else
  WiFiClient client;
#endif
  if (!client.connect(SECRET_API_HOST, SECRET_API_PORT)) return 0;
  client.setTimeout(1500);
  client.print("POST /api/rfid/devices/"); client.print(SECRET_DEVICE_ID); client.print(suffix); client.println(" HTTP/1.1");
  client.print("Host: "); client.println(SECRET_API_HOST);
  client.println("Connection: close"); client.println("Content-Type: application/json");
  client.print("X-Device-Key: "); client.println(SECRET_DEVICE_KEY);
  client.print("Content-Length: "); client.println(body.length()); client.println(); client.print(body);
  unsigned long began = millis(); String line; int status = 0;
  while (millis() - began < 3000 && (client.connected() || client.available())) {
    if (!client.available()) { delay(1); continue; }
    char ch = client.read();
    if (ch == '\n') {
      line.trim();
      if (line.startsWith("HTTP/1.")) { int space = line.indexOf(' '); status = line.substring(space + 1, space + 4).toInt(); }
      String lower = line; lower.toLowerCase();
      if (lower.startsWith("x-rfid-session:")) { newSession = line.substring(line.indexOf(':') + 1); newSession.trim(); }
      if (!line.length()) { client.stop(); return status; }
      line = "";
    } else { line += ch; if (line.length() > 256) break; }
  }
  client.stop(); return 0;
}

void networkStep() {
  unsigned long now = millis();
  if (now - lastNetwork < retryMs) return;
  lastNetwork = now;
  if (!validConfiguration()) { Serial.println("Configure the ignored arduino_secrets.h first"); retryMs = 30000; return; }
  if (WiFi.status() != WL_CONNECTED) {
    sessionId = ""; pendingBody = "";
    Serial.println("WiFi connecting"); WiFi.begin(SECRET_SSID, SECRET_PASS);
    retryMs = min(retryMs * 2UL, 30000UL); return;
  }
  String receivedSession;
  if (!sessionId.length()) {
    int status = post("/session", "{}", receivedSession);
    if (status != 201 || receivedSession.length() != 36) {
      if (status != lastHttpError) { Serial.print("Session unavailable, HTTP "); Serial.println(status); lastHttpError = status; }
      retryMs = min(retryMs * 2UL, 30000UL); return;
    }
    sessionId = receivedSession; sequence = 0; dirty = true;
    Serial.println("RFID session ready");
  }
  if (dirty || (!pendingBody.length() && now - lastFrame >= HEARTBEAT_MS)) {
    if (sequence >= 2147483646UL) { sessionId = ""; pendingBody = ""; return; }
    // Latest-state transport: changes replace an older pending snapshot. No unbounded scan queue.
    pendingBody = makeSnapshot(); dirty = false; lastFrame = now;
  }
  if (!pendingBody.length()) { retryMs = 100; return; }
  int status = post("/snapshot", pendingBody, receivedSession);
  if (status == 200) { pendingBody = ""; retryMs = 100; lastHttpError = 0; }
  else {
    if (status != lastHttpError) { Serial.print("Snapshot pending, HTTP "); Serial.println(status); lastHttpError = status; }
    if (status == 412) { sessionId = ""; pendingBody = ""; }
    retryMs = min(max(retryMs * 2UL, 1000UL), 30000UL);
  }
}

void setup() {
  Serial.begin(115200); // No wait-for-Serial: the board must run without a serial monitor.
  for (byte index = 0; index < 3; index++) { pinMode(SS_PINS[index], OUTPUT); digitalWrite(SS_PINS[index], HIGH); }
  SPI.begin();
  for (byte index = 0; index < RFID_READER_COUNT; index++) {
    readers[index].PCD_Init(SS_PINS[index], RST_PINS[index]);
    byte version = readers[index].PCD_ReadRegister(MFRC522::VersionReg);
    Serial.print("Reader "); Serial.print(index + 1); Serial.print(" version 0x"); Serial.println(version, HEX);
    readers[index].PCD_AntennaOff();
  }
  Serial.println("RFID board initialized; actual presence/removal requires hardware verification");
}

void loop() {
  if (millis() - lastPoll >= POLL_MS) { lastPoll = millis(); pollReaders(); }
  networkStep();
}
