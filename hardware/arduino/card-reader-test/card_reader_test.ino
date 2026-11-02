#include <SPI.h>
#include <MFRC522.h>

#define READER_COUNT 2

byte ssPins[READER_COUNT] = {10, 8};
byte rstPins[READER_COUNT] = {9, 6};
MFRC522 readers[READER_COUNT];
unsigned long lastCheck = 0;

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
