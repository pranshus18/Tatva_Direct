import fs from 'fs';
import multer from 'multer';
import { requireAuthentication as authenticateToken } from '../../../middleware/authMiddleware.js';
import { supabase } from '../../../config/supabase.js';
import { uploadFile } from '../../../services/storage.js';
import {
  fetchPendingChainRequest,
  normalizeCompanyInfoEntries
} from '../../../services/supplierChainProfileService.js';
import { profileUploadCertificateBodySchema } from '../../../contracts/profileContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../../../utils/contractValidation.js';

const upload = multer({ dest: 'uploads/' });

export function registerProfileCertificateRoutes(router) {
  router.post(
    '/supplier/authorization-certificate',
    authenticateToken,
    upload.single('file'),
    async (req, res) => {
      try {
        const uploadBody = parseWithSchema(profileUploadCertificateBodySchema, req.body || {});
        if (!req.file) {
          return res.status(400).json({
            status: 'error',
            message: 'No file uploaded'
          });
        }

        const filePath = req.file.path;
        const fileBuffer = fs.readFileSync(filePath);

        const storagePath = `${req.userId}/authorization-certificates/${Date.now()}-${req.file.originalname}`;

        const { url, path } = await uploadFile('supplier-documents', storagePath, fileBuffer, {
          contentType: req.file.mimetype,
          upsert: false
        });

        try {
          fs.unlinkSync(filePath);
        } catch (cleanupError) {
          console.error('Failed to cleanup temp file:', cleanupError);
        }

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
          const pending = await fetchPendingChainRequest(req.userId);
          if (pending?.payload) {
            const p = pending.payload;
            const entries = normalizeCompanyInfoEntries(p.companyInfoEntries || []);
            const updatedEntries = entries.map((e) =>
              e.id === entryId ? { ...e, authorizationCertificateUrl: url } : e
            );
            if (!updatedEntries.some((e) => e.id === entryId)) {
              return res.status(400).json({
                status: 'error',
                message: 'Entry not found on your pending profile submission'
              });
            }
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
              return res.status(500).json({
                status: 'error',
                message: 'File uploaded, but failed to save URL on pending profile request'
              });
            }
            return res.status(200).json({
              status: 'success',
              message: 'Authorization certificate attached to your pending profile submission',
              url,
              entryId
            });
          }

          const entries = Array.isArray(currentUser.profile?.companyInfoEntries)
            ? currentUser.profile.companyInfoEntries
            : [];
          const updatedEntries = entries.map((e) =>
            e.id === entryId ? { ...e, authorizationCertificateUrl: url } : e
          );
          if (!updatedEntries.some((e) => e.id === entryId)) {
            return res.status(400).json({
              status: 'error',
              message: 'Entry not found for this certificate'
            });
          }
          const updatedProfile = {
            ...(currentUser.profile || {}),
            companyInfoEntries: updatedEntries
          };
          const { error: updateError } = await supabase
            .from('users')
            .update({ profile: updatedProfile })
            .eq('id', req.userId);

          if (updateError) {
            console.error('Failed to save certificate URL for entry:', updateError);
            return res.status(500).json({
              status: 'error',
              message: 'File uploaded, but failed to save URL for this entry'
            });
          }
          return res.status(200).json({
            status: 'success',
            message: 'Authorization certificate uploaded for this entry',
            url,
            entryId
          });
        }

        const updatedProfile = {
          ...(currentUser.profile || {}),
          authorizationCertificateUrl: url,
          authorizationCertificatePath: path
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
          message: 'Authorization certificate uploaded successfully',
          url
        });
      } catch (error) {
        if (String(error?.name || '') === 'ZodError') {
          return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
        }
        console.error('Authorization certificate upload error:', error);
        return res.status(500).json({
          status: 'error',
          message: 'Failed to upload authorization certificate'
        });
      }
    }
  );
}
