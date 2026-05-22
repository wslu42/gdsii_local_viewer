const RECORD_TYPES = {
  0x00: "HEADER",
  0x01: "BGNLIB",
  0x02: "LIBNAME",
  0x03: "UNITS",
  0x04: "ENDLIB",
  0x05: "BGNSTR",
  0x06: "STRNAME",
  0x07: "ENDSTR",
  0x08: "BOUNDARY",
  0x09: "PATH",
  0x0a: "SREF",
  0x0b: "AREF",
  0x0c: "TEXT",
  0x0d: "LAYER",
  0x0e: "DATATYPE",
  0x10: "XY",
  0x11: "ENDEL",
  0x12: "SNAME",
  0x13: "COLROW",
  0x1a: "NODE",
  0x1c: "BOX",
  0x1a: "NODE",
  0x1f: "STRANS",
  0x20: "MAG",
  0x21: "ANGLE",
  0x2b: "PROPATTR",
  0x2c: "PROPVALUE"
};

const DATA_TYPES = {
  0x00: "NO_DATA",
  0x01: "BIT_ARRAY",
  0x02: "INT2",
  0x03: "INT4",
  0x05: "REAL8",
  0x06: "ASCII"
};

const IGNORED_RECORDS = new Set(["TEXT", "PATH", "NODE", "BOX", "PROPATTR", "PROPVALUE"]);

export function parseGds(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const layout = {
    libraryName: "",
    units: { userUnit: 1, dbUnit: 1 },
    cells: {}
  };
  const warnings = [];
  const unsupported = new Set();
  let offset = 0;
  let currentCell = null;
  let currentElement = null;

  while (offset < view.byteLength) {
    if (offset + 4 > view.byteLength) {
      throw new Error("Malformed GDS: truncated record header near byte " + offset + ".");
    }

    const recordOffset = offset;
    const length = view.getUint16(offset, false);
    const typeCode = view.getUint8(offset + 2);
    const dataTypeCode = view.getUint8(offset + 3);
    const recordName = RECORD_TYPES[typeCode] || "UNKNOWN_0x" + typeCode.toString(16);
    const dataType = DATA_TYPES[dataTypeCode] || "UNKNOWN";

    if (length < 4 || recordOffset + length > view.byteLength) {
      throw new Error("Malformed GDS: invalid " + recordName + " length at byte " + recordOffset + ".");
    }

    const dataOffset = offset + 4;
    const dataLength = length - 4;

    try {
      switch (recordName) {
        case "HEADER":
        case "BGNLIB":
          break;
        case "LIBNAME":
          layout.libraryName = readString(view, dataOffset, dataLength);
          break;
        case "UNITS": {
          const nums = readReal8Array(view, dataOffset, dataLength);
          if (nums.length >= 2) {
            layout.units.userUnit = nums[0];
            layout.units.dbUnit = nums[1];
          }
          break;
        }
        case "BGNSTR":
          currentCell = null;
          break;
        case "STRNAME": {
          const name = readString(view, dataOffset, dataLength) || "UNNAMED_CELL";
          currentCell = {
            name,
            polygons: [],
            references: [],
            bbox: null
          };
          layout.cells[name] = currentCell;
          break;
        }
        case "BOUNDARY":
          currentElement = { kind: "BOUNDARY", layer: 0, datatype: 0, xy: [] };
          break;
        case "SREF":
          currentElement = {
            kind: "SREF",
            type: "SREF",
            cellName: "",
            origin: { x: 0, y: 0 },
            angle: 0,
            mag: 1,
            reflected: false
          };
          break;
        case "AREF":
          currentElement = {
            kind: "AREF",
            type: "AREF",
            cellName: "",
            origin: { x: 0, y: 0 },
            angle: 0,
            mag: 1,
            reflected: false,
            columns: 1,
            rows: 1,
            arefPoints: []
          };
          break;
        case "LAYER":
          if (currentElement) currentElement.layer = readInt2(view, dataOffset);
          break;
        case "DATATYPE":
          if (currentElement) currentElement.datatype = readInt2(view, dataOffset);
          break;
        case "SNAME":
          if (currentElement) currentElement.cellName = readString(view, dataOffset, dataLength);
          break;
        case "COLROW":
          if (currentElement) {
            currentElement.columns = readInt2(view, dataOffset);
            currentElement.rows = readInt2(view, dataOffset + 2);
          }
          break;
        case "STRANS":
          if (currentElement) {
            const bits = view.getUint16(dataOffset, false);
            currentElement.reflected = Boolean(bits & 0x8000);
          }
          break;
        case "MAG":
          if (currentElement) currentElement.mag = readReal8(view, dataOffset);
          break;
        case "ANGLE":
          if (currentElement) currentElement.angle = readReal8(view, dataOffset);
          break;
        case "XY":
          if (currentElement) {
            const points = readXY(view, dataOffset, dataLength);
            if (currentElement.kind === "BOUNDARY") {
              currentElement.xy = points;
            } else if (currentElement.kind === "SREF") {
              currentElement.origin = points[0] || currentElement.origin;
            } else if (currentElement.kind === "AREF") {
              currentElement.arefPoints = points;
              currentElement.origin = points[0] || currentElement.origin;
            }
          }
          break;
        case "ENDEL":
          finishElement(currentCell, currentElement, warnings);
          currentElement = null;
          break;
        case "ENDSTR":
          currentCell = null;
          currentElement = null;
          break;
        case "ENDLIB":
          offset = view.byteLength;
          continue;
        default:
          if (!IGNORED_RECORDS.has(recordName)) {
            unsupported.add(recordName + " (" + dataType + ")");
          }
      }
    } catch (error) {
      throw new Error(recordName + " parse failed at byte " + recordOffset + ": " + error.message);
    }

    offset += length;
  }

  for (const cell of Object.values(layout.cells)) {
    cell.bbox = bboxForPolygons(cell.polygons);
  }

  if (unsupported.size) {
    console.warn("Unsupported GDS records ignored:", Array.from(unsupported));
    warnings.push("Ignored unsupported records: " + Array.from(unsupported).join(", "));
  }

  if (!Object.keys(layout.cells).length) {
    warnings.push("No cells were found in this GDS file.");
  }

  return { layout, warnings };
}

function finishElement(cell, element, warnings) {
  if (!cell || !element) return;

  if (element.kind === "BOUNDARY") {
    if (element.xy.length < 3) {
      warnings.push("Skipped a boundary with fewer than 3 points in " + cell.name + ".");
      return;
    }
    const xy = removeClosingPoint(element.xy);
    const polygon = {
      layer: element.layer || 0,
      datatype: element.datatype || 0,
      xy,
      bbox: bboxForPoints(xy)
    };
    cell.polygons.push(polygon);
    return;
  }

  if (element.kind === "SREF" || element.kind === "AREF") {
    if (!element.cellName) {
      warnings.push("Skipped a reference without SNAME in " + cell.name + ".");
      return;
    }
    cell.references.push(cleanReference(element));
  }
}

function cleanReference(element) {
  const ref = {
    type: element.kind,
    cellName: element.cellName,
    origin: element.origin,
    angle: element.angle || 0,
    mag: element.mag || 1,
    reflected: Boolean(element.reflected)
  };
  if (element.kind === "AREF") {
    ref.columns = Math.max(1, element.columns || 1);
    ref.rows = Math.max(1, element.rows || 1);
    ref.arefPoints = element.arefPoints || [];
  }
  return ref;
}

function readString(view, offset, length) {
  let text = "";
  for (let i = 0; i < length; i += 1) {
    const code = view.getUint8(offset + i);
    if (code !== 0) text += String.fromCharCode(code);
  }
  return text.trim();
}

function readInt2(view, offset) {
  return view.getInt16(offset, false);
}

function readInt4(view, offset) {
  return view.getInt32(offset, false);
}

function readXY(view, offset, length) {
  const points = [];
  if (length % 8 !== 0) {
    throw new Error("XY record length is not a multiple of 8 bytes.");
  }
  for (let i = 0; i < length; i += 8) {
    points.push({
      x: readInt4(view, offset + i),
      y: readInt4(view, offset + i + 4)
    });
  }
  return points;
}

function readReal8Array(view, offset, length) {
  const values = [];
  for (let i = 0; i + 8 <= length; i += 8) {
    values.push(readReal8(view, offset + i));
  }
  return values;
}

// GDSII real8 is an IBM-style base-16 float:
// sign bit, 7-bit excess-64 exponent, then a 56-bit fractional mantissa.
function readReal8(view, offset) {
  const first = view.getUint8(offset);
  if (
    first === 0 &&
    view.getUint8(offset + 1) === 0 &&
    view.getUint8(offset + 2) === 0 &&
    view.getUint8(offset + 3) === 0 &&
    view.getUint8(offset + 4) === 0 &&
    view.getUint8(offset + 5) === 0 &&
    view.getUint8(offset + 6) === 0 &&
    view.getUint8(offset + 7) === 0
  ) {
    return 0;
  }

  const sign = first & 0x80 ? -1 : 1;
  const exponent = (first & 0x7f) - 64;
  let mantissa = 0;
  for (let i = 1; i < 8; i += 1) {
    mantissa = mantissa * 256 + view.getUint8(offset + i);
  }
  return sign * (mantissa / Math.pow(2, 56)) * Math.pow(16, exponent);
}

function removeClosingPoint(points) {
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first.x === last.x && first.y === last.y) {
      return points.slice(0, -1);
    }
  }
  return points.slice();
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
