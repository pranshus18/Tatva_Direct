export const SUPPLY_CHAIN_ROLES_IN_ORDER = [
  'manufacturer',
  'stockist',
  'regional_distributor',
  'local_distributor',
  'dealer',
  'retailer'
];

export const SUPPLY_CHAIN_ROLE_LABELS = {
  manufacturer: 'Manufacturer (MGF)',
  stockist: 'Stockist',
  regional_distributor: 'Regional Distributor',
  local_distributor: 'Local Distributor',
  dealer: 'Dealer',
  retailer: 'Retailer'
};

export const ROLE_DEPTH = {
  manufacturer: 0,
  stockist: 1,
  regional_distributor: 2,
  local_distributor: 3,
  dealer: 4,
  retailer: 5
};

export const normalizeBrandKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
