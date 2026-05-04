import { insertAuditLog } from '../repositories/auditLogRepository.js';

export async function writeAuditLog({
  actorUserId = null,
  actorRole = null,
  action,
  resourceType,
  resourceId = null,
  ipAddress = null,
  requestId = null,
  metadata = {}
}) {
  if (!action || !resourceType) return;
  try {
    await insertAuditLog({
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      ip_address: ipAddress,
      request_id: requestId,
      metadata
    });
  } catch (e) {
    console.error('[Audit] Failed to persist audit log:', e?.message || e);
  }
}

export default { writeAuditLog };


