function normalizeSpecShape(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSpecShape(item));
  }
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        out[key] = normalizeSpecShape(value[key]);
      });
    return out;
  }
  return value;
}

export function areSpecificationsEqual(currentSpecs = {}, nextSpecs = {}) {
  return JSON.stringify(normalizeSpecShape(currentSpecs || {})) === JSON.stringify(normalizeSpecShape(nextSpecs || {}));
}

export function shouldMoveToPendingForSpecChange({ specificationsProvided, currentSpecs, nextSpecs }) {
  if (!specificationsProvided) return false;
  return !areSpecificationsEqual(currentSpecs, nextSpecs);
}

export default {
  areSpecificationsEqual,
  shouldMoveToPendingForSpecChange
};
