#include <SPI.h>
#include <MFRC522.h>

#define READER_COUNT 3

byte ssPins[READER_COUNT] = {10, 8, 7};
byte rstPins[READER_COUNT] = {9, 6, 5};
MFRC522 readers[READER_COUNT];
unsigned long lastCheck = 0;
String commandBuffer;
bool droppingCommand = false;

void sendDiagnostics(const String &requestId) {
  Serial.print("{\"protocol_version\":1,\"type\":\"diagnostics\",\"request_id\":\"");
  Serial.print(requestId); Serial.print("\",\"reader_count\":"); Serial.print(READER_COUNT);
  Serial.print(",\"readers\":[");
  for (byte index = 0; index < READER_COUNT; index++) {
    byte version = readers[index].PCD_ReadRegister(MFRC522::VersionReg);
    if (index) Serial.print(',');
    Serial.print("{\"reader_id\":"); Serial.print(index + 1); Serial.print(",\"status\":\"");
    Serial.print(version == 0 || version == 255 ? "ERROR" : "OK"); Serial.print("\"}");
  }
  Serial.println("]}");
}

void readCommands() {
  while (Serial.available()) {
    char value = Serial.read();
    if (value == '\n') {
      if (!droppingCommand && commandBuffer.startsWith("STATUS ")) {
        String requestId = commandBuffer.substring(7);
        bool valid = requestId.length() > 0 && requestId.length() <= 40;
        for (unsigned int i = 0; i < requestId.length(); i++) {
          char c = requestId[i];
          if (!((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '-' || c == '_')) valid = false;
        }
        if (valid) sendDiagnostics(requestId);
      }
      commandBuffer = ""; droppingCommand = false;
    } else if (value != '\r' && !droppingCommand) {
      if (commandBuffer.length() < 48) commandBuffer += value;
      else { commandBuffer = ""; droppingCommand = true; }
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  for (byte i = 0; i < READER_COUNT; i++) {
    pinMode(ssPins[i], OUTPUT);
    digitalWrite(ssPins[i], HIGH);
  }
  SPI.begin();
  Serial.println("=== PECS MATE 2 RFID TEST ===");
  for (byte i = 0; i < READER_COUNT; i++) {
    readers[i].PCD_Init(ssPins[i], rstPins[i]);
    delay(100);
  }
}

void loop() {
  readCommands();
  if (millis() - lastCheck >= 3000) {
    lastCheck = millis();
    for (byte i = 0; i < READER_COUNT; i++) {
      byte version = readers[i].PCD_ReadRegister(MFRC522::VersionReg);
      Serial.print("Reader ");
      Serial.print(i + 1);
      Serial.print(" Version: 0x");
      if (version < 0x10) Serial.print("0");
      Serial.println(version, HEX);
    }
    Serial.println("------------------");
  }

  for (byte i = 0; i < READER_COUNT; i++) {
    if (!readers[i].PICC_IsNewCardPresent()) continue;
    if (!readers[i].PICC_ReadCardSerial()) continue;
    Serial.print("Reader ");
    Serial.print(i + 1);
    Serial.println(" TAG DETECTED!");

    // Keep the reader number and UID on one line so the web cannot mix readers.
    Serial.print("Reader ");
    Serial.print(i + 1);
    Serial.print(" UID: ");
    for (byte j = 0; j < readers[i].uid.size; j++) {
      if (readers[i].uid.uidByte[j] < 0x10) Serial.print("0");
      Serial.print(readers[i].uid.uidByte[j], HEX);
      Serial.print(" ");
    }
    Serial.println();
    readers[i].PICC_HaltA();
    readers[i].PCD_StopCrypto1();
  }
  delay(50);
}
