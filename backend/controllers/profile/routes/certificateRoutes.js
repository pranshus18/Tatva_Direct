import multer from 'multer';
import { requireAuthentication as authenticateToken } from '../../../middleware/authMiddleware.js';
import { supabase } from '../../../config/supabase.js';
import { uploadFile, SUPPLIER_DOCUMENTS_BUCKET } from '../../../services/storage.js';
import {
  fetchPendingChainRequest,
  normalizeCompanyInfoEntries
} from '../../../services/supplierChainProfileService.js';
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
  setAuthorizationCertificateUrls
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

async function attachCertificateToPending(userId, entryId, url, documentType) {
  const pending = await fetchPendingChainRequest(userId);
  if (!pending?.payload) return false;

  const p = pending.payload;
  const entries = normalizeCompanyInfoEntries(p.companyInfoEntries || []);
  if (!entries.some((e) => e.id === entryId)) return false;

  const updatedEntries = entries.map((e) => (e.id === entryId ? appendEntryDocument(e, url, documentType) : e));
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
  const entries = normalizeCompanyInfoEntries(currentProfile?.companyInfoEntries || []);
  if (!entries.some((e) => e.id === entryId)) return false;

  const updatedEntries = entries.map((e) => (e.id === entryId ? appendEntryDocument(e, url, documentType) : e));
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
  const entries = normalizeCompanyInfoEntries(p.companyInfoEntries || []);
  if (!entries.some((e) => e.id === entryId)) return false;

  const updatedEntries = entries.map((e) =>
    e.id === entryId ? removeEntryDocument(e, urlToRemove, documentType) : e
  );
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
  const entries = normalizeCompanyInfoEntries(currentProfile?.companyInfoEntries || []);
  if (!entries.some((e) => e.id === entryId)) return false;

  const updatedEntries = entries.map((e) =>
    e.id === entryId ? removeEntryDocument(e, urlToRemove, documentType) : e
  );
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
  const raw = req.body && Object.keys(req.body).length > 0 ? req.body : req.query || {};
  return parseWithSchema(profileUploadCertificateBodySchema, raw);
}

function resolveDocumentType(rawType) {
  const type = String(rawType || 'role_authorization').trim().toLowerCase();
  return type === 'brand_approval' ? 'brand_approval' : 'role_authorization';
}

function appendEntryDocument(entry, url, documentType) {
  return documentType === 'brand_approval'
    ? appendBrandApprovalDocumentUrl(entry, url)
    : appendAuthorizationCertificateUrl(entry, url);
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

        const { url, path } = await uploadFile(
          SUPPLIER_DOCUMENTS_BUCKET,
          storagePath,
          req.file.buffer,
          {
            contentType,
            upsert: false
          }
        );

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

        const entryId = uploadBody.entryId ? String(uploadBody.entryId).trim() : null;

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
            return res.status(200).json({
              status: 'success',
              message:
                documentType === 'brand_approval'
                  ? 'Brand document uploaded. It is attached in this form — click Save on Select yourself to store it with your profile.'
                  : 'Supply-chain role document uploaded. It is attached in this form — click Save on Select yourself to store it with your profile.',
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
