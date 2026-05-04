import { findOrderById, findOrderByOrderNumber } from '../repositories/ordersRepository.js';

export async function findOrderAccessibleByUser({ orderIdentifier, userId }) {
  let { data: order } = await findOrderByOrderNumber(orderIdentifier);

  if (!order) {
    const { data: byId } = await findOrderById(orderIdentifier);
    order = byId || null;
  }

  if (!order) return null;

  const allowed = order.service_provider_id === userId || order.supplier_id === userId;
  return allowed ? order : null;
}
