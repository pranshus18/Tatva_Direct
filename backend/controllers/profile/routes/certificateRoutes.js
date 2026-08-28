import multer from 'multer';
import { requireAuthentication as authenticateToken } from '../../../middleware/authMiddleware.js';
import { supabase } from '../../../config/supabase.js';
import { uploadFile, SUPPLIER_DOCUMENTS_BUCKET } from '../../../services/storage.js';
import {
  fetchPendingChainRequest,
  normalizeCompanyInfoEntries,
  pendingChainProfileLocksEntry,
  CHAIN_PROFILE_PENDING_LOCK_MESSAGE,
  fetchLatestChainRequest
} from '../../../services/supplierChainProfileService.js';
import { resolveChainRoleOptionsForBrands } from '../profileHelpers.js';
import { profileUploadCertificateBodySchema } from '../../../contracts/profileContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../../../utils/contractValidation.js';
import { clientErrorMessage } from '../../../utils/clientErrorMessage.js';
import {
  appendAuthorizationCertificateUrl,
  appendBrandApprovalDocumentUrl,
  removeBrandApprovalDocumentUrl,
  removeAuthorizationCertificateUrl,
  resolveBrandApprovalDocumentUrls,
  resolveAuthorizationCertificateUrls,
  setBrandApprovalDocumentUrls,
  setAuthorizationCertificateUrls,
  stripBrandDocumentsFromRoleFields
} from '../../../utils/authorizationCertificateUrls.js';

const CERTIFICATE_MAX_BYTES = 15 * 1024 * 1024;
const CERTIFICATE_MAX_SIZE_LABEL = '15 MB';

const ALLOWED_CERT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

const MIME_BY_EXTENSION = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CERTIFICATE_MAX_BYTES }
});

function sanitizeStorageFileName(name) {
  const base = String(name || 'document')
    .replace(/[/\\]+/g, '_')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return base || 'document';
}

function resolveCertificateContentType(file) {
  const mime = String(file?.mimetype || '').toLowerCase().split(';')[0].trim();
  if (ALLOWED_CERT_MIME_TYPES.has(mime)) return mime;
  const ext = String(file?.originalname || '')
    .split('.')
    .pop()
    ?.toLowerCase();
  return ext && MIME_BY_EXTENSION[ext] ? MIME_BY_EXTENSION[ext] : null;
}

function handleCertificateUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        status: 'error',
        message: `File is too large. Maximum size is ${CERTIFICATE_MAX_SIZE_LABEL}.`
      });
    }
    return res.status(400).json({
      status: 'error',
      message: err.message || 'Failed to read uploaded file'
    });
  });
}

function createDraftCompanyInfoEntry(entryId) {
  return {
    id: entryId,
    role: '',
    brands: '',
    gstin: '',
    companyName: '',
    ownershipDetails: '',
    minimumOrderValue: '',
    brandApprovalDocumentUrls: [],
    brandApprovalDocumentUrl: '',
    authorizationCertificateUrls: [],
    authorizationCertificateUrl: '',
    supplyChainRegistrationStarted: true
  };
}

export function upsertEntryDocument(entries, entryId, url, documentType) {
  const normalized = normalizeCompanyInfoEntries(entries || []);
  const idx = normalized.findIndex((e) => String(e?.id || '').trim() === String(entryId || '').trim());
  if (idx === -1) {
    return [...normalized, appendEntryDocument(createDraftCompanyInfoEntry(entryId), url, documentType)];
  }
  return normalized.map((e) =>
    String(e?.id || '').trim() === String(entryId || '').trim() ? appendEntryDocument(e, url, documentType) : e
  );
}

export function findCertificateEntryIndex(entries, entryId, urlToRemove = null, documentType) {
  const list = Array.isArray(entries) ? entries : [];
  const id = String(entryId || '').trim();
  const url = String(urlToRemove || '').trim();
  const entryHasUrl = (entry) => {
    if (!url) return false;
    const urls =
      documentType === 'brand_approval'
        ? resolveBrandApprovalDocumentUrls(entry)
        : resolveAuthorizationCertificateUrls(entry);
    return urls.includes(url);
  };
  const idxById = id ? list.findIndex((entry) => String(entry?.id || '').trim() === id) : -1;
  if (idxById !== -1 && (!url || entryHasUrl(list[idxById]))) return idxById;
  if (url) {
    const idxByUrl = list.findIndex(entryHasUrl);
    if (idxByUrl !== -1) return idxByUrl;
  }
  return idxById;
}

export function removeCertificateFromEntries(entries, entryId, urlToRemove, documentType) {
  const normalized = normalizeCompanyInfoEntries(entries || []);
  const idx = findCertificateEntryIndex(normalized, entryId, urlToRemove, documentType);
  if (idx === -1) return { entries: normalized, removed: false };
  return {
    entries: normalized.map((entry, index) =>
      index === idx ? removeEntryDocument(entry, urlToRemove, documentType) : entry
    ),
    removed: true
  };
}

export function liveEntryHasApprovedRoleDocuments(profile, entryId) {
  const entries = normalizeCompanyInfoEntries(profile?.companyInfoEntries || []);
  const idx = findCertificateEntryIndex(entries, entryId, null, 'role_authorization');
  const entry = idx >= 0 ? entries[idx] : null;
  if (!entry) return false;
  return (
    Boolean(String(entry.role || '').trim()) && resolveAuthorizationCertificateUrls(entry).length > 0
  );
}

async function attachCertificateToPending(userId, entryId, url, documentType) {
  const pending = await fetchPendingChainRequest(userId);
  if (!pending?.payload) return false;

  const p = pending.payload;
  const updatedEntries = upsertEntryDocument(p.companyInfoEntries || [], entryId, url, documentType);
  const { error: prErr } = await supabase
    .from('supplier_chain_profile_requests')
    .update({
      payload: { ...p, companyInfoEntries: updatedEntries },
      updated_at: new Date().toISOString()
    })
    .eq('id', pending.id)
    .eq('status', 'pending');

  if (prErr) {
    console.error('Failed to attach certificate to pending chain request:', prErr);
    throw new Error('File uploaded, but failed to save URL on pending profile request');
  }
  return true;
}

async function attachCertificateToProfile(userId, currentProfile, entryId, url, documentType) {
  const updatedEntries = upsertEntryDocument(currentProfile?.companyInfoEntries || [], entryId, url, documentType);
  const updatedProfile = {
    ...(currentProfile || {}),
    companyInfoEntries: updatedEntries
  };
  const { error: updateError } = await supabase
    .from('users')
    .update({ profile: updatedProfile })
    .eq('id', userId);

  if (updateError) {
    console.error('Failed to save certificate URL for entry:', updateError);
    throw new Error('File uploaded, but failed to save URL for this entry');
  }
  return true;
}

async function clearCertificateFromPending(userId, entryId, urlToRemove = null, documentType) {
  const pending = await fetchPendingChainRequest(userId);
  if (!pending?.payload) return false;

  const p = pending.payload;
  const { entries: updatedEntries, removed } = removeCertificateFromEntries(
    p.companyInfoEntries || [],
    entryId,
    urlToRemove,
    documentType
  );
  if (!removed) return false;
  const { error: prErr } = await supabase
    .from('supplier_chain_profile_requests')
    .update({
      payload: { ...p, companyInfoEntries: updatedEntries },
      updated_at: new Date().toISOString()
    })
    .eq('id', pending.id)
    .eq('status', 'pending');

  if (prErr) {
    console.error('Failed to remove certificate from pending chain request:', prErr);
    throw new Error('Failed to remove certificate from pending profile request');
  }
  return true;
}

async function clearCertificateFromProfile(userId, currentProfile, entryId, urlToRemove = null, documentType) {
  const { entries: updatedEntries, removed } = removeCertificateFromEntries(
    currentProfile?.companyInfoEntries || [],
    entryId,
    urlToRemove,
    documentType
  );
  if (!removed) return false;
  const updatedProfile = {
    ...(currentProfile || {}),
    companyInfoEntries: updatedEntries
  };
  const { error: updateError } = await supabase
    .from('users')
    .update({ profile: updatedProfile })
    .eq('id', userId);

  if (updateError) {
    console.error('Failed to remove certificate URL for entry:', updateError);
    throw new Error('Failed to remove certificate from profile');
  }
  return true;
}

function parseCertificateRequestBody(req) {
  const raw =
    req.body && Object.keys(req.body).length > 0
      ? req.body
      : req.query && Object.keys(req.query).length > 0
        ? req.query
        : {};
  return parseWithSchema(profileUploadCertificateBodySchema, raw);
}

function resolveDocumentType(rawType) {
  const type = String(rawType || 'role_authorization').trim().toLowerCase();
  return type === 'brand_approval' ? 'brand_approval' : 'role_authorization';
}

function brandNameForCertificateEntry(profile, entryId) {
  const wantedId = String(entryId || '').trim();
  if (!wantedId) return '';
  const entry = normalizeCompanyInfoEntries(profile?.companyInfoEntries || []).find(
    (row) => String(row?.id || '').trim() === wantedId
  );
  return String(entry?.brands || '').trim();
}

async function pendingChainProfileLockResponse(res, userId, { entryId = '', brandName = '', documentType } = {}) {
  if (documentType && documentType !== 'role_authorization') return false;
  const pending = await fetchPendingChainRequest(userId);
  if (!pendingChainProfileLocksEntry(pending, { entryId, brandName })) return false;
  res.status(409).json({
    status: 'error',
    code: 'chain_profile_pending_locked',
    message: CHAIN_PROFILE_PENDING_LOCK_MESSAGE
  });
  return true;
}

function appendEntryDocument(entry, url, documentType) {
  const updated =
    documentType === 'brand_approval'
      ? appendBrandApprovalDocumentUrl(entry, url)
      : appendAuthorizationCertificateUrl(entry, url);
  return documentType === 'brand_approval'
    ? stripBrandDocumentsFromRoleFields(updated)
    : updated;
}

function removeEntryDocument(entry, urlToRemove, documentType) {
  return documentType === 'brand_approval'
    ? removeBrandApprovalDocumentUrl(entry, urlToRemove)
    : removeAuthorizationCertificateUrl(entry, urlToRemove);
}

function resolveLegacyDocumentUrls(profile, documentType) {
  return documentType === 'brand_approval'
    ? resolveBrandApprovalDocumentUrls(profile || {})
    : resolveAuthorizationCertificateUrls(profile || {});
}

function setLegacyDocumentUrls(profile, urls, documentType) {
  return documentType === 'brand_approval'
    ? setBrandApprovalDocumentUrls(profile || {}, urls)
    : setAuthorizationCertificateUrls(profile || {}, urls);
}

function resolveEntryBrandName(profile, entryId) {
  const entries = normalizeCompanyInfoEntries(profile?.companyInfoEntries || []);
  const entry = entries.find((row) => String(row?.id || '').trim() === String(entryId || '').trim());
  return String(entry?.brands || '').trim();
}

function parseBrandsFromEntryField(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return [...new Set(raw.map(String).map((s) => s.trim()).filter(Boolean))];
  }
  return [
    ...new Set(
      String(raw)
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ];
}

async function assertBrandApprovedForRoleDocuments(profile, entryId) {
  const brandField = resolveEntryBrandName(profile, entryId);
  const brands = parseBrandsFromEntryField(brandField);
  if (brands.length === 0) return { ok: true };

  const resolved = await resolveChainRoleOptionsForBrands(brands);
  if (resolved.reason === 'brand_not_approved') {
    return {
      ok: false,
      message:
        resolved.message ||
        'This brand has not yet been approved by the admin. Please wait until the approval is complete before proceeding.'
    };
  }
  return { ok: true };
}

export function registerProfileCertificateRoutes(router) {
  router.post(
    '/supplier/authorization-certificate',
    authenticateToken,
    handleCertificateUpload,
    async (req, res) => {
      try {
        const uploadBody = parseCertificateRequestBody(req);
        const documentType = resolveDocumentType(uploadBody.documentType);
        if (!req.file) {
          return res.status(400).json({
            status: 'error',
            message: 'No file uploaded'
          });
        }

        const contentType = resolveCertificateContentType(req.file);
        if (!contentType) {
          return res.status(400).json({
            status: 'error',
            message: 'Please upload a PDF, Word document (.doc/.docx), or image (JPEG, PNG, WebP, GIF).'
          });
        }

        const safeName = sanitizeStorageFileName(req.file.originalname);
        const storageFolder =
          documentType === 'brand_approval' ? 'brand-approval-documents' : 'authorization-certificates';
        const storagePath = `${req.userId}/${storageFolder}/${Date.now()}-${safeName}`;

        const entryId = uploadBody.entryId ? String(uploadBody.entryId).trim() : null;

        const { data: currentUser, error: fetchError } = await supabase
          .from('users')
          .select('id, profile')
          .eq('id', req.userId)
          .single();

        if (fetchError || !currentUser) {
          return res.status(404).json({
            status: 'error',
            message: 'User not found'
          });
        }

        if (documentType === 'role_authorization' && entryId) {
          const approvalCheck = await assertBrandApprovedForRoleDocuments(currentUser.profile, entryId);
          if (!approvalCheck.ok) {
            return res.status(403).json({
              status: 'error',
              code: 'brand_not_approved_for_supply_chain',
              message: approvalCheck.message
            });
          }
          if (
            await pendingChainProfileLockResponse(res, req.userId, {
              entryId,
              brandName: brandNameForCertificateEntry(currentUser.profile, entryId),
              documentType
            })
          ) {
            return;
          }
        }

        const { url, path } = await uploadFile(
          SUPPLIER_DOCUMENTS_BUCKET,
          storagePath,
          req.file.buffer,
          {
            contentType,
            upsert: false
          }
        );

        if (entryId) {
          let savedToProfile = false;
          let message =
            documentType === 'brand_approval'
              ? 'Brand approval document uploaded for this entry'
              : 'Supply-chain role document uploaded for this entry';

          try {
            savedToProfile = await attachCertificateToPending(req.userId, entryId, url, documentType);
            if (savedToProfile) {
              message =
                documentType === 'brand_approval'
                  ? 'Brand approval document attached to your pending profile submission'
                  : 'Supply-chain role document attached to your pending profile submission';
            }
          } catch (pendingErr) {
            return res.status(500).json({
              status: 'error',
              message: pendingErr.message || 'Failed to save certificate on pending profile'
            });
          }

          if (!savedToProfile) {
            const latestChainRequest =
              documentType === 'role_authorization' ? await fetchLatestChainRequest(req.userId) : null;
            const keepOffLiveApprovedRole =
              documentType === 'role_authorization' &&
              String(latestChainRequest?.status || '').toLowerCase() === 'approved' &&
              liveEntryHasApprovedRoleDocuments(currentUser.profile, entryId);

            if (keepOffLiveApprovedRole) {
              return res.status(200).json({
                status: 'success',
                message:
                  'Document uploaded for this role change. Submit the new supply-chain role to send it for admin approval. Extra documents are not added to the current approved role.',
                url,
                entryId,
                documentType,
                savedToProfile: false
              });
            }

            try {
              savedToProfile = await attachCertificateToProfile(
                req.userId,
                currentUser.profile,
                entryId,
                url,
                documentType
              );
            } catch (profileErr) {
              return res.status(500).json({
                status: 'error',
                message: profileErr.message || 'Failed to save certificate on profile'
              });
            }
          }

          if (!savedToProfile) {
            return res.status(422).json({
              status: 'error',
              message:
                documentType === 'brand_approval'
                  ? 'File uploaded, but it could not be linked to your brand entry. Select your brand, then try uploading again.'
                  : 'File uploaded, but it could not be linked to your role entry. Select your brand and role, then try uploading again.',
              url,
              entryId,
              documentType,
              savedToProfile: false
            });
          }

          return res.status(200).json({
            status: 'success',
            message,
            url,
            entryId,
            documentType,
            savedToProfile: true
          });
        }

        const legacyCertificates = setLegacyDocumentUrls(
          currentUser.profile || {},
          [...resolveLegacyDocumentUrls(currentUser.profile || {}, documentType), url],
          documentType
        );
        const updatedProfile = {
          ...legacyCertificates,
          ...(documentType === 'brand_approval'
            ? { brandApprovalDocumentPath: path }
            : { authorizationCertificatePath: path })
        };

        const { error: updateError } = await supabase
          .from('users')
          .update({ profile: updatedProfile })
          .eq('id', req.userId);

        if (updateError) {
          console.error('Failed to update user profile with certificate URL:', updateError);
          return res.status(500).json({
            status: 'error',
            message: 'File uploaded, but failed to save URL in profile'
          });
        }

        return res.status(200).json({
          status: 'success',
          message:
            documentType === 'brand_approval'
              ? 'Brand approval document uploaded successfully'
              : 'Supply-chain role document uploaded successfully',
          url,
          documentType,
          savedToProfile: true
        });
      } catch (error) {
        if (String(error?.name || '') === 'ZodError') {
          return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
        }
        console.error('Authorization certificate upload error:', error);
        return res.status(500).json({
          status: 'error',
          message: clientErrorMessage(
            error,
            'Failed to upload authorization certificate',
            500
          )
        });
      }
    }
  );

  router.delete('/supplier/authorization-certificate', authenticateToken, async (req, res) => {
    try {
      const deleteBody = parseCertificateRequestBody(req);
      const documentType = resolveDocumentType(deleteBody.documentType);

      const { data: currentUser, error: fetchError } = await supabase
        .from('users')
        .select('id, profile')
        .eq('id', req.userId)
        .single();

      if (fetchError || !currentUser) {
        return res.status(404).json({
          status: 'error',
          message: 'User not found'
        });
      }

      const entryId = deleteBody.entryId ? String(deleteBody.entryId).trim() : null;
      const urlToRemove = deleteBody.url ? String(deleteBody.url).trim() : null;

      if (
        documentType === 'role_authorization' &&
        (await pendingChainProfileLockResponse(res, req.userId, {
          entryId,
          brandName: brandNameForCertificateEntry(currentUser.profile, entryId),
          documentType
        }))
      ) {
        return;
      }

      if (entryId) {
        let savedToProfile = false;
        let message = urlToRemove
          ? documentType === 'brand_approval'
            ? 'Brand approval document removed for this entry'
            : 'Supply-chain role document removed for this entry'
          : documentType === 'brand_approval'
            ? 'Brand approval documents removed for this entry'
            : 'Supply-chain role documents removed for this entry';

        try {
          savedToProfile = await clearCertificateFromPending(req.userId, entryId, urlToRemove, documentType);
          if (savedToProfile) {
            message = urlToRemove
              ? documentType === 'brand_approval'
                ? 'Brand approval document removed from your pending profile submission'
                : 'Supply-chain role document removed from your pending profile submission'
              : documentType === 'brand_approval'
                ? 'Brand approval documents removed from your pending profile submission'
                : 'Supply-chain role documents removed from your pending profile submission';
          }
        } catch (pendingErr) {
          return res.status(500).json({
            status: 'error',
            message: pendingErr.message || 'Failed to remove certificate from pending profile'
          });
        }

        if (!savedToProfile) {
          try {
            savedToProfile = await clearCertificateFromProfile(
              req.userId,
              currentUser.profile,
              entryId,
              urlToRemove,
              documentType
            );
          } catch (profileErr) {
            return res.status(500).json({
              status: 'error',
              message: profileErr.message || 'Failed to remove certificate from profile'
            });
          }
        }

        if (!savedToProfile) {
          return res.status(200).json({
            status: 'success',
            message:
              'Certificate removed in this form. Click Save on Select yourself to persist the change.',
            entryId,
            documentType,
            savedToProfile: false
          });
        }

        return res.status(200).json({
          status: 'success',
          message,
          entryId,
          documentType,
          savedToProfile: true
        });
      }

      const updatedProfile = setLegacyDocumentUrls(
        { ...(currentUser.profile || {}) },
        urlToRemove
          ? resolveLegacyDocumentUrls(currentUser.profile || {}, documentType).filter((u) => u !== urlToRemove)
          : [],
        documentType
      );
      if (!urlToRemove || resolveLegacyDocumentUrls(updatedProfile, documentType).length === 0) {
        if (documentType === 'brand_approval') {
          delete updatedProfile.brandApprovalDocumentPath;
        } else {
          delete updatedProfile.authorizationCertificatePath;
        }
      }

      const { error: updateError } = await supabase
        .from('users')
        .update({ profile: updatedProfile })
        .eq('id', req.userId);

      if (updateError) {
        console.error('Failed to remove certificate from profile:', updateError);
        return res.status(500).json({
          status: 'error',
          message: 'Failed to remove authorization certificate from profile'
        });
      }

      return res.status(200).json({
        status: 'success',
        message:
          documentType === 'brand_approval'
            ? 'Brand approval document removed successfully'
            : 'Supply-chain role document removed successfully',
        documentType,
        savedToProfile: true
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Authorization certificate delete error:', error);
      return res.status(500).json({
        status: 'error',
        message: clientErrorMessage(
          error,
          'Failed to remove authorization certificate',
          500
        )
      });
    }
  });
}
