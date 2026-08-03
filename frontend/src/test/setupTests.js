import '@testing-library/jest-dom/vitest';

// jsdom does not implement scrollIntoView; components call it when focusing cards/fields.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoViewStub() {};
}
