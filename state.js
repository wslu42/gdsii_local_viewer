export const appState = {
  fileName: "",
  layout: null,
  topCells: [],
  selectedTopCell: "",
  expanded: null,
  layerVisibility: new Map(),
  maxDepth: 10,
  polygonLimit: 50000,
  view: {
    scale: 1,
    offsetX: 0,
    offsetY: 0
  },
  pointer: null,
  warnings: []
};

export function resetLayoutState() {
  appState.layout = null;
  appState.topCells = [];
  appState.selectedTopCell = "";
  appState.expanded = null;
  appState.layerVisibility = new Map();
  appState.pointer = null;
  appState.warnings = [];
}
