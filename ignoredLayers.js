// Layers that are present in source GDS files but should be hidden by default
// in the quick viewer. Users can still enable them from the layer panel.
export const IGNORED_LAYERS = [
  { layer: 900, datatype: 21 },
  { layer: 900, datatype: 23 },
  { layer: 900, datatype: 25 },
  { layer: 900, datatype: 907 },
  { layer: 1201, datatype: 0 },
  { layer: 1291, datatype: 0 },
  { layer: 1292, datatype: 0 },
  { layer: 2001, datatype: 0 }
];

export const IGNORED_LAYER_KEYS = new Set(
  IGNORED_LAYERS.map((item) => layerKey(item.layer, item.datatype))
);

export function isIgnoredLayer(layer, datatype) {
  return IGNORED_LAYER_KEYS.has(layerKey(layer, datatype));
}

function layerKey(layer, datatype) {
  return String(layer) + "/" + String(datatype);
}
