"use strict";

const SERVICE_UUID = "6d8f7a10-2a4b-4c6d-9e1f-7b3a5c8d9010";
const CHARACTERISTIC_UUID = "6d8f7a11-2a4b-4c6d-9e1f-7b3a5c8d9010";
const STORAGE_KEY = "h2oclearx.readings.v1";
const MAX_STORED_READINGS = 20000;
const DEMO_INTERVAL_MS = 500;
const chartHistory = [];

const elements = {
  connectButton: document.querySelector("#connect-button"),
  connectionStatus: document.querySelector("#connection-status"),
  connectionMessage: document.querySelector("#connection-message"),
  demoToggle: document.querySelector("#demo-toggle"),
  demoBadge: document.querySelector("#demo-badge"),
  voltage: document.querySelector("#voltage-value"),
  voltageScale: document.querySelector("#voltage-scale"),
  level: document.querySelector("#level-value"),
  levelDescription: document.querySelector("#level-description"),
  levelIndicator: document.querySelector("#level-indicator"),
  concentration: document.querySelector("#concentration-value"),
  concentrationScale: document.querySelector("#concentration-scale"),
  chartCanvas: document.querySelector("#concentration-chart"),
  chartEmpty: document.querySelector("#chart-empty"),
  chartCount: document.querySelector("#chart-count"),
  table: document.querySelector("#readings-table"),
  savedCount: document.querySelector("#saved-count"),
  location: document.querySelector("#filter-location"),
  sizeMin: document.querySelector("#filter-size-min"),
  sizeMax: document.querySelector("#filter-size-max"),
  sampleLocation: document.querySelector("#sample-location"),
  sampleSizeMin: document.querySelector("#sample-size-min"),
  sampleSizeMax: document.querySelector("#sample-size-max"),
  dateFrom: document.querySelector("#filter-date-from"),
  dateTo: document.querySelector("#filter-date-to"),
  loginDialog: document.querySelector("#login-dialog"),
  loginMessage: document.querySelector("#login-message")
};

let device = null;
let characteristic = null;
let demoTimer = null;
let chart = null;
let demoVoltage = 2.45;
let demoDirection = -1;

function loadReadings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(stored) ? stored.filter(isValidRecord) : [];
  } catch (error) {
    setStatus("Saved data could not be read from this browser.", "error");
    return [];
  }
}

function isValidRecord(record) {
  return record && typeof record.timestamp === "string" && Number.isFinite(record.voltage) &&
    Number.isFinite(record.concentration) && typeof record.level === "string";
}

let readings = loadReadings();

function setStatus(message, state = "idle") {
  elements.connectionMessage.textContent = message;
  elements.connectionStatus.dataset.state = state;
}

function updateLatestReading(reading) {
  elements.voltage.textContent = reading.voltage.toFixed(3);
  elements.voltageScale.style.width = `${Math.max(0, Math.min(100, reading.voltage / 3.3 * 100))}%`;
  elements.level.textContent = reading.level;
  elements.level.dataset.level = reading.level;
  elements.concentration.textContent = reading.concentration.toFixed(1);
  elements.concentrationScale.style.width = `${Math.max(0, Math.min(100, reading.concentration))}%`;

  const levelPosition = Math.max(0, Math.min(100, (3.3 - reading.voltage) / 3.3 * 100));
  elements.levelIndicator.style.left = `${levelPosition}%`;
  const descriptions = {
    Baseline: "Clear-water reference range",
    Medium: "Moderate optical scattering",
    High: "Elevated optical scattering",
    "Very High": "Strong optical scattering"
  };
  elements.levelDescription.textContent = descriptions[reading.level] || "Sensor reading received";
}

function currentContext() {
  const min = Number.parseFloat(elements.sampleSizeMin.value);
  const max = Number.parseFloat(elements.sampleSizeMax.value);
  return {
    location: elements.sampleLocation.value || "Unspecified",
    sizeMin: Number.isFinite(min) ? min : null,
    sizeMax: Number.isFinite(max) ? max : null
  };
}

function saveReading(reading, source = "device") {
  const record = {
    timestamp: new Date().toISOString(),
    voltage: reading.voltage,
    level: reading.level,
    concentration: reading.concentration,
    source,
    ...currentContext()
  };

  readings.push(record);
  if (readings.length > MAX_STORED_READINGS) {
    readings = readings.slice(-MAX_STORED_READINGS);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readings));
  } catch (error) {
    setStatus("Browser storage is full; this reading is visible but may not persist.", "error");
  }

  updateLatestReading(reading);
  chartHistory.push({ timestamp: record.timestamp, concentration: record.concentration });
  if (chartHistory.length > 60) chartHistory.shift();
  updateChart();
  renderTable();
}

function getFilteredReadings() {
  const location = elements.location.value;
  const min = Number.parseFloat(elements.sizeMin.value);
  const max = Number.parseFloat(elements.sizeMax.value);
  const from = elements.dateFrom.value ? new Date(`${elements.dateFrom.value}T00:00:00`).getTime() : -Infinity;
  const through = elements.dateTo.value ? new Date(`${elements.dateTo.value}T23:59:59.999`).getTime() : Infinity;

  return readings.filter((record) => {
    const timestamp = new Date(record.timestamp).getTime();
    if (location && record.location !== location) return false;
    if (Number.isFinite(min) && (record.sizeMax == null || record.sizeMax < min)) return false;
    if (Number.isFinite(max) && (record.sizeMin == null || record.sizeMin > max)) return false;
    return timestamp >= from && timestamp <= through;
  });
}

function renderTable() {
  const filtered = getFilteredReadings().slice().reverse().slice(0, 100);
  elements.savedCount.textContent = String(readings.length);
  elements.table.replaceChildren();

  if (filtered.length === 0) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No saved readings match these filters.";
    row.append(cell);
    elements.table.append(row);
    return;
  }

  for (const record of filtered) {
    const row = document.createElement("tr");
    const time = new Date(record.timestamp);
    const size = record.sizeMin == null && record.sizeMax == null
      ? "Not set"
      : `${record.sizeMin ?? "0"}–${record.sizeMax ?? "∞"} µm`;
    const values = [
      time.toLocaleString(), record.location || "Unspecified", `${record.voltage.toFixed(3)} V`,
      record.level, `${record.concentration.toFixed(1)} idx`, size
    ];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      if (index === 3) {
        const badge = document.createElement("span");
        badge.className = "table-level";
        badge.dataset.level = record.level;
        const dot = document.createElement("i");
        badge.append(dot, document.createTextNode(value));
        cell.append(badge);
      } else {
        cell.textContent = value;
      }
      row.append(cell);
    });
    elements.table.append(row);
  }
}

function initializeChart() {
  if (!window.Chart) {
    const chartScript = [...document.scripts].find((script) => script.src.includes("chart.umd"));
    if (chartScript) {
      chartScript.addEventListener("load", initializeChart, { once: true });
      chartScript.addEventListener("error", () => {
        elements.chartEmpty.textContent = "Chart.js could not load. Reading capture and CSV export still work.";
      }, { once: true });
    } else {
      elements.chartEmpty.textContent = "Chart.js could not load. Reading capture and CSV export still work.";
    }
    return;
  }
  if (chart) return;

  chart = new Chart(elements.chartCanvas, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label: "Relative index",
        data: [],
        borderColor: "#8de3c5",
        backgroundColor: "rgba(141, 227, 197, .08)",
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 4,
        pointBackgroundColor: "#8de3c5",
        fill: true,
        tension: .28
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false } },
      interaction: { mode: "nearest", axis: "x", intersect: false },
      scales: {
        x: { grid: { color: "rgba(168, 211, 211, .07)" }, ticks: { color: "#789398", maxTicksLimit: 7, maxRotation: 0, font: { size: 9 } } },
        y: { min: 0, max: 100, grid: { color: "rgba(168, 211, 211, .09)" }, ticks: { color: "#789398", maxTicksLimit: 5, font: { size: 9 } } }
      }
    }
  });
  if (chartHistory.length === 0) {
    chartHistory.push(...readings.slice(-60).map((record) => ({ timestamp: record.timestamp, concentration: record.concentration })));
  }
  updateChart();
}

function updateChart() {
  const isDemo = elements.demoToggle.checked;
  elements.demoBadge.hidden = !isDemo;
  elements.chartEmpty.hidden = chartHistory.length > 0;
  elements.chartCount.textContent = `${chartHistory.length} ${chartHistory.length === 1 ? "reading" : "readings"}`;
  if (!chart) return;
  chart.data.labels = chartHistory.map((point) => new Date(point.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  chart.data.datasets[0].data = chartHistory.map((point) => point.concentration);
  chart.data.datasets[0].label = isDemo ? "DEMO DATA · Relative index" : "Relative index";
  chart.update("none");
}

function levelFromVoltage(voltage) {
  if (voltage > 2.8) return "Baseline";
  if (voltage >= 1.5) return "Medium";
  if (voltage >= .5) return "High";
  return "Very High";
}

function handleDeviceReading(event) {
  try {
    const payload = new TextDecoder().decode(event.target.value);
    const reading = JSON.parse(payload);
    if (!Number.isFinite(reading.v) || !Number.isFinite(reading.conc) || typeof reading.level !== "string") {
      throw new TypeError("The device sent an incomplete reading.");
    }
    saveReading({ voltage: reading.v, level: reading.level, concentration: reading.conc }, "device");
  } catch (error) {
    setStatus(`Could not read sensor data: ${error.message}`, "error");
  }
}

async function connectDevice() {
  if (!navigator.bluetooth) {
    setStatus("Web Bluetooth is unavailable. Open this page in Chromium over HTTPS or localhost.", "error");
    return;
  }

  elements.connectButton.disabled = true;
  setStatus("Choose your H2O ClearX device in the browser prompt…");
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ name: "h2oclear-x" }],
      optionalServices: [SERVICE_UUID]
    });
    device.addEventListener("gattserverdisconnected", handleDisconnect);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", handleDeviceReading);
    stopDemo();
    elements.demoToggle.checked = false;
    setStatus(`Connected to ${device.name || "H2O ClearX"}. Waiting for the next reading.`, "connected");
  } catch (error) {
    if (error.name === "NotFoundError") {
      setStatus("No device selected. Keep the sensor powered and nearby, then try again.");
    } else {
      setStatus(`Connection failed: ${error.message || "Check the sensor and try again."}`, "error");
    }
  } finally {
    elements.connectButton.disabled = false;
  }
}

function handleDisconnect() {
  characteristic?.removeEventListener("characteristicvaluechanged", handleDeviceReading);
  characteristic = null;
  device = null;
  setStatus("Device disconnected. Saved readings are still available.");
  if (elements.demoToggle.checked) startDemo();
}

function startDemo() {
  if (device?.gatt?.connected) {
    setStatus("Disconnect the sensor before starting demo mode.", "error");
    elements.demoToggle.checked = false;
    return;
  }
  stopDemo();
  elements.demoBadge.hidden = false;
  setStatus("Demo mode is generating simulated readings every 500 ms.");
  generateDemoReading();
  demoTimer = window.setInterval(generateDemoReading, DEMO_INTERVAL_MS);
}

function generateDemoReading() {
  demoVoltage += demoDirection * (Math.random() * .11 + .025);
  if (demoVoltage < .32 || demoVoltage > 3.12) demoDirection *= -1;
  demoVoltage = Math.max(.18, Math.min(3.25, demoVoltage));
  const baseline = 3.3;
  saveReading({
    voltage: demoVoltage,
    level: levelFromVoltage(demoVoltage),
    concentration: Math.max(0, Math.min(100, (baseline - demoVoltage) / baseline * 100))
  }, "demo");
}

function stopDemo() {
  if (demoTimer !== null) window.clearInterval(demoTimer);
  demoTimer = null;
  elements.demoBadge.hidden = true;
}

function exportCsv() {
  const filtered = getFilteredReadings();
  if (filtered.length === 0) {
    setStatus("There are no matching readings to export.", "error");
    return;
  }
  const columns = ["timestamp", "location", "voltage_v", "level", "concentration_index", "size_min_um", "size_max_um", "source"];
  const rows = filtered.map((record) => [
    record.timestamp, record.location || "Unspecified", record.voltage, record.level,
    record.concentration, record.sizeMin ?? "", record.sizeMax ?? "", record.source || "device"
  ]);
  const escapeCsv = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = [columns, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `h2oclearx-readings-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`Exported ${filtered.length} matching readings as CSV.`, "connected");
}

function clearReadings() {
  if (!window.confirm("Delete all saved H2O ClearX readings from this browser?")) return;
  readings = [];
  chartHistory.length = 0;
  localStorage.removeItem(STORAGE_KEY);
  updateChart();
  renderTable();
  setStatus("All saved readings have been cleared.");
}

function setupLogin() {
  document.querySelectorAll("[data-open-login]").forEach((button) => button.addEventListener("click", () => elements.loginDialog.showModal()));
  document.querySelector("[data-close-login]").addEventListener("click", () => elements.loginDialog.close());
  elements.loginDialog.addEventListener("click", (event) => {
    if (event.target === elements.loginDialog) elements.loginDialog.close();
  });
  document.querySelector("#login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const email = document.querySelector("#login-email").value;
    elements.loginMessage.textContent = `Demo access ready for ${email}. No credentials were saved.`;
    document.querySelector("#login-form").reset();
  });
}

elements.connectButton.addEventListener("click", connectDevice);
elements.demoToggle.addEventListener("change", () => {
  if (elements.demoToggle.checked) startDemo();
  else {
    stopDemo();
    setStatus(device?.gatt?.connected ? `Connected to ${device.name || "H2O ClearX"}.` : "Demo mode stopped.", device?.gatt?.connected ? "connected" : "idle");
    updateChart();
  }
});
document.querySelector("#filter-form").addEventListener("input", renderTable);
document.querySelector("#filter-form").addEventListener("change", renderTable);
document.querySelector("#filter-form").addEventListener("reset", () => window.setTimeout(renderTable, 0));
document.querySelector("#export-button").addEventListener("click", exportCsv);
document.querySelector("#clear-button").addEventListener("click", clearReadings);
setupLogin();
initializeChart();
renderTable();