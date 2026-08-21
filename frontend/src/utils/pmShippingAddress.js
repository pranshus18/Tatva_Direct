const PRESET_SUBTYPES = new Set(['HOME', 'WORK', 'OTHER']);

export const PM_ADDRESS_TYPE = 'SHIPPING';

export const PM_ADDRESS_SUBTYPE_OPTIONS = [
  { id: 'HOME', label: 'Home' },
  { id: 'WORK', label: 'Work' },
  { id: 'OTHER', label: 'Other' }
];

function clean(value) {
  return String(value || '').trim();
}

export function emptyPmShippingAddressForm() {
  return {
    subType: 'HOME',
    customSubType: '',
    building: '',
    buildingName: '',
    floor: '',
    street: '',
    locality: '',
    district: '',
    zip: '',
    state: '',
    isDefault: false
  };
}

export function buildFormattedPmAddress(fields = {}) {
  return [
    fields.building,
    fields.buildingName,
    fields.floor,
    fields.street,
    fields.locality,
    fields.district,
    fields.state,
    fields.zip
  ]
    .map((part) => clean(part))
    .filter(Boolean)
    .join(', ');
}

export function resolvePmAddressSubType(form = {}) {
  if (String(form.subType || '').toUpperCase() === 'OTHER') {
    return clean(form.customSubType) || 'OTHER';
  }
  const preset = String(form.subType || 'HOME').toUpperCase();
  return PRESET_SUBTYPES.has(preset) ? preset : clean(form.subType) || 'HOME';
}

export function validatePmShippingAddressForm(form = {}) {
  const errors = {};
  if (!clean(form.building)) {
    errors.building = 'Building/House No is required.';
  }
  if (!/^\d{6}$/.test(clean(form.zip))) {
    errors.zip = 'Enter a valid 6-digit pincode.';
  }
  if (!clean(form.state)) {
    errors.state = 'State is required.';
  }
  if (String(form.subType || '').toUpperCase() === 'OTHER' && !clean(form.customSubType)) {
    errors.customSubType = 'Enter a subtype (e.g. Warehouse).';
  }
  return errors;
}

export function buildPmShippingAddressRequest(form = {}) {
  const building = clean(form.building);
  const buildingName = clean(form.buildingName);
  const floor = clean(form.floor);
  const street = clean(form.street);
  const locality = clean(form.locality);
  const district = clean(form.district);
  const zip = clean(form.zip);
  const state = clean(form.state);
  const subType = resolvePmAddressSubType(form);
  const formatted_address = buildFormattedPmAddress({
    building,
    buildingName,
    floor,
    street,
    locality,
    district,
    state,
    zip
  });

  return {
    type: PM_ADDRESS_TYPE,
    subType,
    label: subType,
    building,
    buildingName,
    floor,
    street,
    locality,
    district,
    zip,
    state,
    formatted_address,
    isDefault: form.isDefault === true,
    line1: [building, buildingName, floor, street].filter(Boolean).join(', ') || formatted_address,
    city: locality || district,
    pincode: zip,
    country: 'India'
  };
}

export function mapResolvedLocationToPmForm(resolved = {}) {
  const line1 = clean(resolved.line1);
  const street = clean(resolved.street) || line1;
  return {
    building: clean(resolved.building),
    buildingName: clean(resolved.buildingName),
    floor: clean(resolved.floor),
    street,
    locality: clean(resolved.locality || resolved.city),
    district: clean(resolved.district),
    zip: clean(resolved.zip || resolved.pincode),
    state: clean(resolved.state)
  };
}

/** Apply PM pincode lookup onto the add-address form. Pincode-owned geo fields are replaced. */
export function applyPincodeLookupToForm(form = {}, address = {}) {
  const locality = clean(address.locality || address.city);
  const district = clean(address.district);
  const state = clean(address.state);
  const street = clean(address.street);
  return {
    ...form,
    state: state || form.state,
    district: district || form.district,
    locality: locality || form.locality,
    street: clean(form.street) ? form.street : street || form.street
  };
}
