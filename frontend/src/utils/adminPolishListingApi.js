import { getApiUrl } from '../config/api';

export async function polishSupplierListingWithAi({
  productName,
  category = '',
  supplierDescription,
  existingSpecifications = {},
  provider = 'auto',
  adminNotes = ''
}) {
  const token = localStorage.getItem('token');
  const response = await fetch(getApiUrl('/api/admin/products/ai-polish-listing'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      productName,
      category,
      supplierDescription,
      existingSpecifications,
      provider,
      adminNotes
    })
  });

  const data = await response.json().catch(() => ({ status: 'error', message: 'Invalid response' }));
  return { response, data };
}
