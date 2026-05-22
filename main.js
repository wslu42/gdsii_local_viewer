import { appState } from "./state.js";
import { CanvasRenderer } from "./rendererCanvas.js";
import { setupControls } from "./controls.js";

const canvas = document.getElementById("layoutCanvas");
let controls;

const renderer = new CanvasRenderer(canvas, appState, {
  onPointer: () => controls && controls.updateInfo(),
  onViewChanged: () => controls && controls.updateInfo()
});

controls = setupControls(renderer);
