// USB JSON Lines; UNO R4 WiFi / MFRC522. No Wi-Fi credentials or network setup.
#include <SPI.h>
#include <MFRC522.h>

// Verify one physical reader first, then change to 2 or 3 after wiring checks.
#define RFID_READER_COUNT 1
#if RFID_READER_COUNT < 1 || RFID_READER_COUNT > 3
#error "RFID_READER_COUNT must be 1, 2 or 3"
#endif
const byte SS_PINS[3] = {10, 8, 7}, RST_PINS[3] = {9, 6, 5};
MFRC522 readers[3];
struct Slot {
  String uid, candidate;
  const char *status = "ERROR";
  byte confirmations = 0, misses = 0;
  unsigned long lastSeen = 0;
};
Slot slots[3];
unsigned long lastPoll = 0, lastSent = 0;
uint32_t sequence = 0;
String bootId;
bool dirty = true, wasConnected = false;

void setSlot(byte index, const char *status, const String &uid = "") {
  if (slots[index].uid == uid && strcmp(slots[index].status, status) == 0) return;
  slots[index].uid = uid; slots[index].status = status; dirty = true;
}

void pollReaders() {
  for (byte index = 0; index < RFID_READER_COUNT; index++) {
    MFRC522 &reader = readers[index]; Slot &slot = slots[index];
    reader.PCD_AntennaOn(); delay(5);
    byte atqa[2], size = sizeof(atqa);
    MFRC522::StatusCode result = reader.PICC_WakeupA(atqa, &size);
    bool present = (result == MFRC522::STATUS_OK || result == MFRC522::STATUS_COLLISION) && reader.PICC_ReadCardSerial();
    if (present) {
      String uid;
      for (byte part = 0; part < reader.uid.size; part++) {
        if (reader.uid.uidByte[part] < 16) uid += '0';
        uid += String(reader.uid.uidByte[part], HEX);
      }
      uid.toUpperCase(); slot.lastSeen = millis(); slot.misses = 0;
      if (slot.candidate != uid) { slot.candidate = uid; slot.confirmations = 1; }
      else if (slot.confirmations < 2) slot.confirmations++;
      if (slot.confirmations >= 2) setSlot(index, "PRESENT", uid);
      reader.PICC_HaltA(); reader.PCD_StopCrypto1();
    } else {
      slot.confirmations = 0; slot.candidate = "";
      byte version = reader.PCD_ReadRegister(MFRC522::VersionReg);
      if (version == 0 || version == 255 || (result != MFRC522::STATUS_TIMEOUT && millis() - slot.lastSeen >= 1200)) setSlot(index, "ERROR");
      else if (result == MFRC522::STATUS_TIMEOUT) {
        if (slot.misses < 255) slot.misses++;
        if (slot.misses >= 4 && millis() - slot.lastSeen >= 1200) setSlot(index, "EMPTY");
      }
    }
    reader.PCD_AntennaOff();
  }
}

void sendSnapshot() {
  // Boot ID is a stream nonce, never a device credential. The browser also scopes each open session.
  if (sequence >= 2147483646UL) { bootId += 'x'; sequence = 0; }
  Serial.print("{\"protocol_version\":1,\"type\":\"snapshot\",\"boot_id\":\""); Serial.print(bootId);
  Serial.print("\",\"event_id\":"); Serial.print(++sequence);
  Serial.print(",\"reader_count\":"); Serial.print(RFID_READER_COUNT); Serial.print(",\"readers\":[");
  for (byte index = 0; index < RFID_READER_COUNT; index++) {
    if (index) Serial.print(',');
    bool ambiguous = false;
    for (byte other = 0; other < RFID_READER_COUNT; other++) if (other != index && slots[index].uid.length() && slots[index].uid == slots[other].uid) ambiguous = true;
    Serial.print("{\"reader_id\":"); Serial.print(index + 1);
    Serial.print(",\"status\":\""); Serial.print(ambiguous ? "ERROR" : slots[index].status); Serial.print("\",\"uid\":");
    if (slots[index].uid.length() && !ambiguous) { Serial.print('"'); Serial.print(slots[index].uid); Serial.print('"'); }
    else Serial.print("null");
    Serial.print('}');
  }
  Serial.println("]}"); lastSent = millis(); dirty = false;
}

void setup() {
  Serial.begin(115200);
  randomSeed(analogRead(A0) ^ micros());
  bootId = String(random(1, 2147483646L), HEX) + "-" + String(micros(), HEX);
  for (byte index = 0; index < 3; index++) { pinMode(SS_PINS[index], OUTPUT); digitalWrite(SS_PINS[index], HIGH); }
  SPI.begin();
  for (byte index = 0; index < RFID_READER_COUNT; index++) {
    readers[index].PCD_Init(SS_PINS[index], RST_PINS[index]); readers[index].PCD_AntennaOff();
  }
}

void loop() {
  if (millis() - lastPoll >= 100) { lastPoll = millis(); pollReaders(); }
  bool connected = bool(Serial);
  if (connected && !wasConnected) dirty = true;
  wasConnected = connected;
  if (connected && (dirty || millis() - lastSent >= 5000)) sendSnapshot();
}
