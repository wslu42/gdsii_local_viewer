import { layerKey } from "./layoutModel.js";

export class CanvasRenderer {
  constructor(canvas, state, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.state = state;
    this.callbacks = callbacks;
    this.dpr = 1;
    this.drag = null;
    this.pinch = null;

    this.bindEvents();
    this.resize();
  }

  bindEvents() {
    window.addEventListener("resize", () => {
      this.resize();
      this.render();
    });

    this.canvas.addEventListener("mousedown", (event) => this.startMouseDrag(event));
    window.addEventListener("mousemove", (event) => this.moveMouse(event));
    window.addEventListener("mouseup", () => this.endMouseDrag());
    this.canvas.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });

    this.canvas.addEventListener("touchstart", (event) => this.handleTouchStart(event), { passive: false });
    this.canvas.addEventListener("touchmove", (event) => this.handleTouchMove(event), { passive: false });
    this.canvas.addEventListener("touchend", (event) => this.handleTouchEnd(event), { passive: false });
    this.canvas.addEventListener("touchcancel", (event) => this.handleTouchEnd(event), { passive: false });
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  resetView() {
    this.state.view.scale = 1;
    this.state.view.offsetX = this.canvas.clientWidth / 2;
    this.state.view.offsetY = this.canvas.clientHeight / 2;
    this.render();
  }

  fitToView(bbox) {
    if (!bbox) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const layoutWidth = Math.max(1, bbox.maxX - bbox.minX);
    const layoutHeight = Math.max(1, bbox.maxY - bbox.minY);
    const padding = 36;
    const scaleX = (width - padding * 2) / layoutWidth;
    const scaleY = (height - padding * 2) / layoutHeight;
    const scale = Math.max(0.000001, Math.min(scaleX, scaleY));
    const centerX = (bbox.minX + bbox.maxX) / 2;
    const centerY = (bbox.minY + bbox.maxY) / 2;
    this.state.view.scale = scale;
    this.state.view.offsetX = width / 2 - centerX * scale;
    this.state.view.offsetY = height / 2 + centerY * scale;
    this.render();
  }

  screenToWorld(screenX, screenY) {
    const view = this.state.view;
    return {
      x: (screenX - view.offsetX) / view.scale,
      y: (view.offsetY - screenY) / view.scale
    };
  }

  worldToScreen(point) {
    const view = this.state.view;
    return {
      x: point.x * view.scale + view.offsetX,
      y: view.offsetY - point.y * view.scale
    };
  }

  zoomAt(screenX, screenY, factor) {
    const before = this.screenToWorld(screenX, screenY);
    this.state.view.scale = clamp(this.state.view.scale * factor, 0.0000001, 1000);
    this.state.view.offsetX = screenX - before.x * this.state.view.scale;
    this.state.view.offsetY = screenY + before.y * this.state.view.scale;
    this.render();
  }

  render() {
    this.resize();
    const ctx = this.ctx;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#101418";
    ctx.fillRect(0, 0, width, height);
    this.drawGrid(width, height);

    const expanded = this.state.expanded;
    if (!expanded || !expanded.polygons.length) {
      this.drawEmptyMessage();
      this.notifyViewChanged();
      return;
    }

    const grouped = new Map();
    for (const polygon of expanded.polygons) {
      const key = layerKey(polygon.layer, polygon.datatype);
      if (this.state.layerVisibility.get(key) === false) continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(polygon);
    }

    for (const [key, polygons] of grouped) {
      ctx.beginPath();
      for (const polygon of polygons) {
        this.tracePolygon(ctx, polygon);
      }
      ctx.fillStyle = colorForLayerKey(key, 0.72);
      ctx.strokeStyle = colorForLayerKey(key, 0.95);
      ctx.lineWidth = 1;
      ctx.fill("evenodd");
      ctx.stroke();
    }

    this.notifyViewChanged();
  }

  drawGrid(width, height) {
    const ctx = this.ctx;
    const view = this.state.view;
    const target = 90;
    const worldStep = niceStep(target / Math.max(view.scale, 0.0000001));
    const start = this.screenToWorld(0, height);
    const end = this.screenToWorld(width, 0);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(start.x / worldStep) * worldStep; x <= end.x; x += worldStep) {
      const sx = this.worldToScreen({ x, y: 0 }).x;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
    }
    for (let y = Math.floor(start.y / worldStep) * worldStep; y <= end.y; y += worldStep) {
      const sy = this.worldToScreen({ x: 0, y }).y;
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawEmptyMessage() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.68)";
    ctx.textAlign = "center";
    ctx.font = "15px system-ui, sans-serif";
    ctx.fillText("Open a GDS file or load the demo", this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
    ctx.restore();
  }

  tracePolygon(ctx, polygon) {
    if (!polygon.xy.length) return;
    const first = this.worldToScreen(polygon.xy[0]);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < polygon.xy.length; i += 1) {
      const point = this.worldToScreen(polygon.xy[i]);
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
  }

  startMouseDrag(event) {
    event.preventDefault();
    const p = localPoint(this.canvas, event.clientX, event.clientY);
    this.drag = {
      x: p.x,
      y: p.y,
      offsetX: this.state.view.offsetX,
      offsetY: this.state.view.offsetY
    };
    this.updatePointer(p.x, p.y);
  }

  moveMouse(event) {
    const p = localPoint(this.canvas, event.clientX, event.clientY);
    if (this.drag) {
      this.state.view.offsetX = this.drag.offsetX + p.x - this.drag.x;
      this.state.view.offsetY = this.drag.offsetY + p.y - this.drag.y;
      this.render();
    }
    this.updatePointer(p.x, p.y);
  }

  endMouseDrag() {
    this.drag = null;
  }

  handleWheel(event) {
    event.preventDefault();
    const p = localPoint(this.canvas, event.clientX, event.clientY);
    const factor = Math.exp(-event.deltaY * 0.0015);
    this.zoomAt(p.x, p.y, factor);
    this.updatePointer(p.x, p.y);
  }

  handleTouchStart(event) {
    event.preventDefault();
    if (event.touches.length === 1) {
      const p = localPoint(this.canvas, event.touches[0].clientX, event.touches[0].clientY);
      this.drag = {
        x: p.x,
        y: p.y,
        offsetX: this.state.view.offsetX,
        offsetY: this.state.view.offsetY
      };
      this.pinch = null;
      this.updatePointer(p.x, p.y);
    } else if (event.touches.length === 2) {
      this.drag = null;
      this.pinch = this.makePinch(event.touches);
    }
  }

  handleTouchMove(event) {
    event.preventDefault();
    if (event.touches.length === 1 && this.drag) {
      const p = localPoint(this.canvas, event.touches[0].clientX, event.touches[0].clientY);
      this.state.view.offsetX = this.drag.offsetX + p.x - this.drag.x;
      this.state.view.offsetY = this.drag.offsetY + p.y - this.drag.y;
      this.updatePointer(p.x, p.y);
      this.render();
    } else if (event.touches.length === 2 && this.pinch) {
      const next = this.makePinch(event.touches);
      const factor = next.distance / Math.max(1, this.pinch.distance);
      this.state.view.scale = clamp(this.pinch.scale * factor, 0.0000001, 1000);
      this.state.view.offsetX = next.center.x - this.pinch.world.x * this.state.view.scale;
      this.state.view.offsetY = next.center.y + this.pinch.world.y * this.state.view.scale;
      this.updatePointer(next.center.x, next.center.y);
      this.render();
    }
  }

  handleTouchEnd(event) {
    event.preventDefault();
    if (event.touches.length === 0) {
      this.drag = null;
      this.pinch = null;
    } else if (event.touches.length === 1) {
      this.handleTouchStart(event);
    }
  }

  makePinch(touches) {
    const p1 = localPoint(this.canvas, touches[0].clientX, touches[0].clientY);
    const p2 = localPoint(this.canvas, touches[1].clientX, touches[1].clientY);
    const center = {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2
    };
    return {
      center,
      distance: Math.hypot(p2.x - p1.x, p2.y - p1.y),
      scale: this.state.view.scale,
      world: this.screenToWorld(center.x, center.y)
    };
  }

  updatePointer(x, y) {
    this.state.pointer = this.screenToWorld(x, y);
    if (this.callbacks.onPointer) this.callbacks.onPointer(this.state.pointer);
  }

  notifyViewChanged() {
    if (this.callbacks.onViewChanged) this.callbacks.onViewChanged();
  }
}

export function colorForLayerKey(key, alpha = 1) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = Math.abs(hash) % 360;
  return "hsla(" + hue + ", 78%, 58%, " + alpha + ")";
}

function localPoint(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function niceStep(raw) {
  const exp = Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const base = raw / Math.pow(10, exp);
  const nice = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return nice * Math.pow(10, exp);
}
