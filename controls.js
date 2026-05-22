import { appState, resetLayoutState } from "./state.js";
import {
  createDemoLayout,
  detectTopCells,
  expandCell,
  formatBbox,
  formatPoint,
  layerKey
} from "./layoutModel.js";
import { colorForLayerKey } from "./rendererCanvas.js";
import { parseGds } from "./gdsParser.js";

export function setupControls(renderer) {
  const ui = getUi();

  ui.fileInput.addEventListener("change", async () => {
    const file = ui.fileInput.files && ui.fileInput.files[0];
    if (!file) return;
    await loadFile(file, renderer, ui);
  });

  ui.demoButton.addEventListener("click", () => {
    resetLayoutState();
    appState.fileName = "Built-in demo";
    appState.layout = createDemoLayout();
    appState.warnings = [];
    initializeLayout(renderer, ui);
    setStatus(ui, "Demo layout loaded.", "normal");
  });

  ui.topCellSelect.addEventListener("change", () => {
    appState.selectedTopCell = ui.topCellSelect.value;
    rebuildExpansion(renderer, ui, true);
  });

  ui.depthInput.addEventListener("change", () => {
    const value = Number.parseInt(ui.depthInput.value, 10);
    appState.maxDepth = Number.isFinite(value) ? Math.max(0, Math.min(32, value)) : 10;
    ui.depthInput.value = String(appState.maxDepth);
    rebuildExpansion(renderer, ui, true);
  });

  ui.fitButton.addEventListener("click", () => {
    renderer.fitToView(appState.expanded && appState.expanded.bbox);
    updateInfo(ui);
  });

  ui.resetButton.addEventListener("click", () => {
    renderer.resetView();
    updateInfo(ui);
  });

  updateInfo(ui);
  renderer.render();

  return {
    updateInfo: () => updateInfo(ui)
  };
}

async function loadFile(file, renderer, ui) {
  resetLayoutState();
  appState.fileName = file.name;
  setStatus(ui, "Loading " + file.name + "...", "normal");

  if (file.size > 80 * 1024 * 1024) {
    setStatus(ui, "Warning: this file is large (" + prettyBytes(file.size) + "). iOS Safari may be slow.", "warning");
  }

  try {
    const buffer = await file.arrayBuffer();
    const result = parseGds(buffer);
    appState.layout = result.layout;
    appState.warnings = result.warnings || [];
    initializeLayout(renderer, ui);
    const message = ["Loaded " + file.name + "."].concat(appState.warnings).join("\n");
    setStatus(ui, message, appState.warnings.length ? "warning" : "normal");
  } catch (error) {
    console.error(error);
    resetLayoutState();
    appState.fileName = file.name;
    clearControls(ui);
    renderer.render();
    updateInfo(ui);
    setStatus(ui, "Could not parse this GDS file.\n" + error.message, "error");
  }
}

function initializeLayout(renderer, ui) {
  appState.topCells = detectTopCells(appState.layout);
  if (!appState.topCells.length) {
    appState.warnings.push("No top cell found.");
  }
  appState.selectedTopCell = appState.topCells[0] || "";
  populateTopCells(ui);
  rebuildExpansion(renderer, ui, true);
}

function rebuildExpansion(renderer, ui, fit) {
  if (!appState.layout || !appState.selectedTopCell) {
    appState.expanded = null;
    clearControls(ui);
    renderer.render();
    updateInfo(ui);
    return;
  }

  appState.expanded = expandCell(appState.layout, appState.selectedTopCell, {
    maxDepth: appState.maxDepth,
    polygonLimit: appState.polygonLimit
  });

  const existingVisibility = new Map(appState.layerVisibility);
  appState.layerVisibility = new Map();
  for (const layer of appState.expanded.layers) {
    appState.layerVisibility.set(layer.key, existingVisibility.get(layer.key) !== false);
  }

  populateLayers(ui, renderer);
  ui.fitButton.disabled = !appState.expanded.bbox;
  ui.resetButton.disabled = false;

  const warnings = []
    .concat(appState.warnings || [])
    .concat(appState.expanded.warnings || []);
  if (!appState.expanded.polygons.length) warnings.push("No polygons found in selected top cell.");
  setStatus(ui, warnings.length ? warnings.join("\n") : "Ready.", warnings.length ? "warning" : "normal");

  if (fit) renderer.fitToView(appState.expanded.bbox);
  renderer.render();
  updateInfo(ui);
}

function populateTopCells(ui) {
  ui.topCellSelect.innerHTML = "";
  for (const cellName of appState.topCells) {
    const option = document.createElement("option");
    option.value = cellName;
    option.textContent = cellName;
    ui.topCellSelect.appendChild(option);
  }
  ui.topCellSelect.value = appState.selectedTopCell;
  ui.topCellSelect.disabled = appState.topCells.length <= 1;
}

function populateLayers(ui, renderer) {
  ui.layerList.innerHTML = "";
  ui.layerList.classList.toggle("empty", !appState.expanded.layers.length);
  if (!appState.expanded.layers.length) {
    ui.layerList.textContent = "No polygon layers";
    return;
  }

  for (const layer of appState.expanded.layers) {
    const row = document.createElement("label");
    row.className = "layer-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = appState.layerVisibility.get(layer.key) !== false;
    checkbox.addEventListener("change", () => {
      appState.layerVisibility.set(layer.key, checkbox.checked);
      renderer.render();
      updateInfo(ui);
    });

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = colorForLayerKey(layer.key, 0.85);

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = "Layer " + layer.layer + " / " + layer.datatype;

    const count = document.createElement("span");
    count.className = "layer-count";
    count.textContent = layer.count.toLocaleString();

    row.append(checkbox, swatch, name, count);
    ui.layerList.appendChild(row);
  }
}

function updateInfo(ui) {
  const expanded = appState.expanded;
  const visibleLayers = expanded
    ? expanded.layers.filter((layer) => appState.layerVisibility.get(layerKey(layer.layer, layer.datatype)) !== false).length
    : 0;

  ui.infoFile.textContent = appState.fileName || "-";
  ui.infoLibrary.textContent = appState.layout && appState.layout.libraryName ? appState.layout.libraryName : "-";
  ui.infoTopCell.textContent = appState.selectedTopCell || "-";
  ui.infoBbox.textContent = expanded ? formatBbox(expanded.bbox, appState.layout) : "-";
  ui.infoPolygons.textContent = expanded ? expanded.polygons.length.toLocaleString() : "-";
  ui.infoVisibleLayers.textContent = expanded ? visibleLayers + " / " + expanded.layers.length : "-";
  ui.infoZoom.textContent = appState.view.scale.toPrecision(4) + " px/dbu";
  ui.infoPointer.textContent = appState.layout ? formatPoint(appState.pointer, appState.layout) : "-";
}

function clearControls(ui) {
  ui.topCellSelect.innerHTML = "";
  ui.topCellSelect.disabled = true;
  ui.layerList.innerHTML = "No layers loaded";
  ui.layerList.classList.add("empty");
  ui.fitButton.disabled = true;
  ui.resetButton.disabled = true;
}

function setStatus(ui, message, tone) {
  ui.statusBox.textContent = message;
  ui.statusBox.classList.toggle("error", tone === "error");
  ui.statusBox.classList.toggle("warning", tone === "warning");
}

function getUi() {
  return {
    fileInput: document.getElementById("fileInput"),
    demoButton: document.getElementById("demoButton"),
    topCellSelect: document.getElementById("topCellSelect"),
    depthInput: document.getElementById("depthInput"),
    fitButton: document.getElementById("fitButton"),
    resetButton: document.getElementById("resetButton"),
    layerList: document.getElementById("layerList"),
    statusBox: document.getElementById("statusBox"),
    infoFile: document.getElementById("infoFile"),
    infoLibrary: document.getElementById("infoLibrary"),
    infoTopCell: document.getElementById("infoTopCell"),
    infoBbox: document.getElementById("infoBbox"),
    infoPolygons: document.getElementById("infoPolygons"),
    infoVisibleLayers: document.getElementById("infoVisibleLayers"),
    infoZoom: document.getElementById("infoZoom"),
    infoPointer: document.getElementById("infoPointer")
  };
}

function prettyBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return value.toFixed(unit ? 1 : 0) + " " + units[unit];
}
