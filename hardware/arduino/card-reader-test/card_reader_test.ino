
#include <SPI.h>
#include <MFRC522.h>

#define SS_PIN 10
#define RST_PIN 9

MFRC522 rfid(SS_PIN, RST_PIN);

unsigned long lastCheck = 0;

void setup() {
  Serial.begin(115200);
  delay(2000);

  SPI.begin();
  rfid.PCD_Init();
  delay(100);

  Serial.println("=== PECS Mate RFID TEST ===");
}

void loop() {

  // 3초마다 리더기 상태 확인
  if (millis() - lastCheck >= 3000) {
    lastCheck = millis();

    byte version = rfid.PCD_ReadRegister(
      MFRC522::VersionReg
    );

    Serial.print("RC522 Version: 0x");
    if (version < 0x10) Serial.print("0");
    Serial.println(version, HEX);

    if (version == 0x00 || version == 0xFF) {
      Serial.println("RFID CONNECTION ERROR");
    } else {
      Serial.println("RFID Reader Connected");
    }
  }

  // RFID 태그 감지
  if (!rfid.PICC_IsNewCardPresent()) {
    return;
  }

  // UID 읽기
  if (!rfid.PICC_ReadCardSerial()) {
    return;
  }

  Serial.println("RFID TAG DETECTED!");

  Serial.print("UID: ");

  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) {
      Serial.print("0");
    }

    Serial.print(rfid.uid.uidByte[i], HEX);
    Serial.print(" ");
  }

  Serial.println();

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  delay(500);
}
