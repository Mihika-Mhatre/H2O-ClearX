#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

const uint8_t SENSOR_PIN = 34;
const uint8_t CALIBRATION_BUTTON_PIN = 0;
const uint8_t ADC_SAMPLE_COUNT = 10;
const uint8_t BASELINE_SAMPLE_COUNT = 50;
const uint16_t STREAM_INTERVAL_MS = 500;
const uint16_t BUTTON_DEBOUNCE_MS = 40;
const float ADC_REFERENCE_VOLTS = 3.3f;

const float BASELINE_THRESHOLD_VOLTS = 2.8f;
const float MEDIUM_THRESHOLD_VOLTS = 1.5f;
const float HIGH_THRESHOLD_VOLTS = 0.5f;
const float CONCENTRATION_SCALE = 100.0f;

const char *BLE_DEVICE_NAME = "h2oclear-x";
const char *BLE_SERVICE_UUID = "6d8f7a10-2a4b-4c6d-9e1f-7b3a5c8d9010";
const char *BLE_CHARACTERISTIC_UUID = "6d8f7a11-2a4b-4c6d-9e1f-7b3a5c8d9010";

BLECharacteristic *readingCharacteristic = nullptr;
float baselineVolts = ADC_REFERENCE_VOLTS;
uint32_t lastStreamAt = 0;
uint32_t lastButtonChangeAt = 0;
bool lastButtonState = HIGH;

class AdvertisingCallbacks : public BLEServerCallbacks {
  void onDisconnect(BLEServer *server) override {
    BLEDevice::startAdvertising();
  }
};

float readVoltage(uint8_t sampleCount) {
  uint32_t totalAdc = 0;
  for (uint8_t sample = 0; sample < sampleCount; sample++) {
    totalAdc += analogRead(SENSOR_PIN);
    delayMicroseconds(500);
  }

  const float averageAdc = static_cast<float>(totalAdc) / sampleCount;
  return averageAdc * ADC_REFERENCE_VOLTS / 4095.0f;
}

const char *classifyLevel(float voltage) {
  if (voltage > BASELINE_THRESHOLD_VOLTS) return "Baseline";
  if (voltage >= MEDIUM_THRESHOLD_VOLTS) return "Medium";
  if (voltage >= HIGH_THRESHOLD_VOLTS) return "High";
  return "Very High";
}

float estimateConcentration(float voltage) {
  const float fraction = (baselineVolts - voltage) / baselineVolts;
  return constrain(fraction * CONCENTRATION_SCALE, 0.0f, CONCENTRATION_SCALE);
}

void calibrate() {
  baselineVolts = readVoltage(BASELINE_SAMPLE_COUNT);
  if (baselineVolts < 0.05f) {
    baselineVolts = 0.05f;
  }

  Serial.printf("Calibration complete. Baseline: %.3f V\n", baselineVolts);
}

void printReading(float voltage, const char *level, float concentration, uint32_t now) {
  const uint32_t hours = (now / 3600000UL) % 100UL;
  const uint32_t minutes = (now / 60000UL) % 60UL;
  const uint32_t seconds = (now / 1000UL) % 60UL;
  const uint16_t milliseconds = now % 1000UL;

  Serial.printf(
      "%02lu:%02lu:%02lu.%03u -> Voltage: %.3f V --> Level: %s | Conc: %.1f\n",
      static_cast<unsigned long>(hours),
      static_cast<unsigned long>(minutes),
      static_cast<unsigned long>(seconds),
      milliseconds,
      voltage,
      level,
      concentration);
}

void streamReading(float voltage, const char *level, float concentration, uint32_t now) {
  char payload[128];
  snprintf(
      payload,
      sizeof(payload),
      "{\"t\":%lu,\"v\":%.3f,\"level\":\"%s\",\"conc\":%.1f}",
      static_cast<unsigned long>(now),
      voltage,
      level,
      concentration);

  readingCharacteristic->setValue(payload);
  readingCharacteristic->notify();
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  analogSetPinAttenuation(SENSOR_PIN, ADC_11db);
  pinMode(CALIBRATION_BUTTON_PIN, INPUT_PULLUP);

  BLEDevice::init(BLE_DEVICE_NAME);
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new AdvertisingCallbacks());
  BLEService *service = server->createService(BLE_SERVICE_UUID);
  readingCharacteristic = service->createCharacteristic(
      BLE_CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  readingCharacteristic->addDescriptor(new BLE2902());
  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(BLE_SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("H2O ClearX ready. Hold GPIO0 button briefly to calibrate in distilled water.");
}

void loop() {
  const uint32_t now = millis();
  const bool buttonState = digitalRead(CALIBRATION_BUTTON_PIN);

  if (buttonState != lastButtonState) {
    lastButtonChangeAt = now;
    lastButtonState = buttonState;
  }

  if (buttonState == LOW && (now - lastButtonChangeAt) >= BUTTON_DEBOUNCE_MS) {
    calibrate();
    while (digitalRead(CALIBRATION_BUTTON_PIN) == LOW) {
      delay(10);
    }
    lastButtonState = HIGH;
    lastButtonChangeAt = millis();
  }

  if (now - lastStreamAt >= STREAM_INTERVAL_MS) {
    lastStreamAt = now;
    const float voltage = readVoltage(ADC_SAMPLE_COUNT);
    const char *level = classifyLevel(voltage);
    const float concentration = estimateConcentration(voltage);
    printReading(voltage, level, concentration, now);
    streamReading(voltage, level, concentration, now);
  }
}