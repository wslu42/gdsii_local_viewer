export function detectTopCells(layout) {
  const referenced = new Set();
  for (const cell of Object.values(layout.cells)) {
    for (const ref of cell.references) {
      referenced.add(ref.cellName);
    }
  }
  const tops = Object.keys(layout.cells).filter((name) => !referenced.has(name));
  return tops.length ? tops.sort() : Object.keys(layout.cells).sort();
}

export function summarizeLayers(polygons) {
  const map = new Map();
  for (const polygon of polygons) {
    const key = layerKey(polygon.layer, polygon.datatype);
    const item = map.get(key) || {
      key,
      layer: polygon.layer,
      datatype: polygon.datatype,
      count: 0
    };
    item.count += 1;
    map.set(key, item);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.layer !== b.layer) return a.layer - b.layer;
    return a.datatype - b.datatype;
  });
}

export function layerKey(layer, datatype) {
  return String(layer) + "/" + String(datatype);
}

export function expandCell(layout, topCellName, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 10;
  const polygonLimit = Number.isFinite(options.polygonLimit) ? options.polygonLimit : 50000;
  const polygons = [];
  const warnings = [];
  const missingRefs = new Set();
  let limitHit = false;

  function visit(cellName, transform, depth, stack) {
    if (limitHit) return;
    const cell = layout.cells[cellName];
    if (!cell) {
      missingRefs.add(cellName);
      return;
    }
    if (depth > maxDepth) {
      warnings.push("Stopped expansion at max hierarchy depth " + maxDepth + ".");
      return;
    }
    if (stack.includes(cellName)) {
      warnings.push("Stopped recursive reference cycle: " + stack.concat(cellName).join(" -> ") + ".");
      return;
    }

    for (const polygon of cell.polygons) {
      if (polygons.length >= polygonLimit) {
        limitHit = true;
        warnings.push("Polygon limit reached at " + polygonLimit.toLocaleString() + ". Rendering is truncated.");
        return;
      }
      const xy = polygon.xy.map((point) => applyTransform(point, transform));
      polygons.push({
        layer: polygon.layer,
        datatype: polygon.datatype,
        xy,
        bbox: bboxForPoints(xy),
        sourceCell: cellName
      });
    }

    for (const ref of cell.references) {
      if (limitHit) return;
      if (ref.type === "AREF") {
        for (const arrayTransform of expandArefTransforms(ref)) {
          visit(ref.cellName, composeTransforms(transform, arrayTransform), depth + 1, stack.concat(cellName));
          if (limitHit) return;
        }
      } else {
        visit(ref.cellName, composeTransforms(transform, transformFromReference(ref)), depth + 1, stack.concat(cellName));
      }
    }
  }

  visit(topCellName, identityTransform(), 0, []);

  if (missingRefs.size) {
    warnings.push("Missing referenced cells: " + Array.from(missingRefs).sort().join(", "));
  }

  const bbox = bboxForPolygons(polygons);
  const layers = summarizeLayers(polygons);
  return {
    topCellName,
    polygons,
    bbox,
    layers,
    warnings,
    truncated: limitHit
  };
}

export function createDemoLayout() {
  const childPoly = rect(-80, -45, 80, 45, 3, 0);
  return {
    libraryName: "LOCAL_DEMO",
    units: {
      userUnit: 0.001,
      dbUnit: 1e-9
    },
    cells: {
      COUPLER: {
        name: "COUPLER",
        polygons: [
          childPoly,
          rect(-20, -140, 20, 140, 4, 0)
        ],
        references: [],
        bbox: bboxForPolygons([childPoly, rect(-20, -140, 20, 140, 4, 0)])
      },
      TOP: {
        name: "TOP",
        polygons: [
          rect(-2500, -1600, 2500, 1600, 1, 0),
          rect(-2200, -120, 2200, 120, 2, 0),
          rect(-2200, 240, 2200, 360, 2, 0),
          rect(-2200, -360, 2200, -240, 2, 0),
          polygon([
            { x: -1200, y: 700 },
            { x: -620, y: 900 },
            { x: -500, y: 1240 },
            { x: -1420, y: 1080 }
          ], 5, 0),
          polygon([
            { x: 760, y: -1050 },
            { x: 1280, y: -980 },
            { x: 1160, y: -620 },
            { x: 680, y: -760 }
          ], 6, 0)
        ],
        references: [
          {
            type: "SREF",
            cellName: "COUPLER",
            origin: { x: -900, y: 0 },
            angle: 0,
            mag: 1,
            reflected: false
          },
          {
            type: "SREF",
            cellName: "COUPLER",
            origin: { x: 900, y: 0 },
            angle: 180,
            mag: 1,
            reflected: false
          },
          {
            type: "AREF",
            cellName: "COUPLER",
            origin: { x: -1200, y: -900 },
            angle: 0,
            mag: 0.7,
            reflected: false,
            columns: 4,
            rows: 2,
            arefPoints: [
              { x: -1200, y: -900 },
              { x: 1200, y: -900 },
              { x: -1200, y: -300 }
            ]
          }
        ],
        bbox: null
      }
    }
  };
}

export function formatDbCoord(value, layout) {
  const scale = micronScale(layout);
  if (scale) return (value * scale).toFixed(3) + " um";
  return Math.round(value).toLocaleString() + " dbu";
}

export function formatPoint(point, layout) {
  if (!point) return "-";
  const scale = micronScale(layout);
  if (scale) {
    return (point.x * scale).toFixed(3) + ", " + (point.y * scale).toFixed(3) + " um";
  }
  return Math.round(point.x).toLocaleString() + ", " + Math.round(point.y).toLocaleString() + " dbu";
}

export function formatBbox(bbox, layout) {
  if (!bbox) return "-";
  return [
    formatDbCoord(bbox.minX, layout),
    formatDbCoord(bbox.minY, layout),
    formatDbCoord(bbox.maxX, layout),
    formatDbCoord(bbox.maxY, layout)
  ].join(" / ");
}

function micronScale(layout) {
  const dbUnitMeters = layout && layout.units ? layout.units.dbUnit : 0;
  return dbUnitMeters ? dbUnitMeters * 1e6 : 0;
}

function identityTransform() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function transformFromReference(ref) {
  const angle = (ref.angle || 0) * Math.PI / 180;
  const mag = ref.mag || 1;
  const reflect = ref.reflected ? -1 : 1;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const base = { a: mag, b: 0, c: 0, d: mag * reflect, e: 0, f: 0 };
  const rot = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  const move = { a: 1, b: 0, c: 0, d: 1, e: ref.origin.x, f: ref.origin.y };
  return composeTransforms(move, composeTransforms(rot, base));
}

function expandArefTransforms(ref) {
  const columns = Math.max(1, ref.columns || 1);
  const rows = Math.max(1, ref.rows || 1);
  const points = ref.arefPoints || [];
  const origin = points[0] || ref.origin || { x: 0, y: 0 };
  const colEnd = points[1] || { x: origin.x, y: origin.y };
  const rowEnd = points[2] || { x: origin.x, y: origin.y };
  const colStep = {
    x: columns > 1 ? (colEnd.x - origin.x) / columns : 0,
    y: columns > 1 ? (colEnd.y - origin.y) / columns : 0
  };
  const rowStep = {
    x: rows > 1 ? (rowEnd.x - origin.x) / rows : 0,
    y: rows > 1 ? (rowEnd.y - origin.y) / rows : 0
  };
  const transforms = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      transforms.push(transformFromReference({
        ...ref,
        origin: {
          x: origin.x + colStep.x * col + rowStep.x * row,
          y: origin.y + colStep.y * col + rowStep.y * row
        }
      }));
    }
  }
  return transforms;
}

function composeTransforms(parent, child) {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    e: parent.a * child.e + parent.c * child.f + parent.e,
    f: parent.b * child.e + parent.d * child.f + parent.f
  };
}

function applyTransform(point, t) {
  return {
    x: point.x * t.a + point.y * t.c + t.e,
    y: point.x * t.b + point.y * t.d + t.f
  };
}

function rect(minX, minY, maxX, maxY, layer, datatype) {
  return polygon([
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY }
  ], layer, datatype);
}

function polygon(xy, layer, datatype) {
  return {
    layer,
    datatype,
    xy,
    bbox: bboxForPoints(xy)
  };
}

function bboxForPoints(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function bboxForPolygons(polygons) {
  let bbox = null;
  for (const polygon of polygons) {
    bbox = mergeBbox(bbox, polygon.bbox);
  }
  return bbox;
}

function mergeBbox(a, b) {
  if (!b) return a;
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  };
}
