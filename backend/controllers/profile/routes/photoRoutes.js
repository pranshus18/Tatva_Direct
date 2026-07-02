import fs from 'fs';
import multer from 'multer';
import { requireAuthentication as authenticateToken } from '../../../middleware/authMiddleware.js';
import { supabase } from '../../../config/supabase.js';
import { uploadFile, PROFILE_PHOTOS_BUCKET } from '../../../services/storage.js';
import { PROFILE_PHOTO_MAX_BYTES, PROFILE_PHOTO_MAX_SIZE_LABEL } from '../profileHelpers.js';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: PROFILE_PHOTO_MAX_BYTES }
});
const isProduction = () => process.env.NODE_ENV === 'production';

export function registerProfilePhotoRoutes(router) {
  router.post('/photo', authenticateToken, upload.single('file'), async (req, res) => {
    let tempPath = null;
    try {
      if (!req.file) {
        return res.status(400).json({ status: 'error', message: 'No image uploaded' });
      }
      if (!ALLOWED_MIME_TYPES.has(req.file.mimetype)) {
        return res.status(400).json({
          status: 'error',
          message: 'Please upload a JPEG, PNG, WebP, or GIF image.'
        });
      }
      if (req.file.size > PROFILE_PHOTO_MAX_BYTES) {
        return res.status(400).json({
          status: 'error',
          message: `Image is too large. Maximum size is ${PROFILE_PHOTO_MAX_SIZE_LABEL}.`
        });
      }

      tempPath = req.file.path;
      const fileBuffer = await fs.promises.readFile(tempPath);
      const ext = req.file.mimetype === 'image/png' ? 'png' : req.file.mimetype === 'image/webp' ? 'webp' : req.file.mimetype === 'image/gif' ? 'gif' : 'jpg';
      const storagePath = `${req.userId}/avatar-${Date.now()}.${ext}`;

      const { url } = await uploadFile(PROFILE_PHOTOS_BUCKET, storagePath, fileBuffer, {
        contentType: req.file.mimetype,
        upsert: true
      });

      const { data: currentUser, error: fetchError } = await supabase
        .from('users')
        .select('id, profile')
        .eq('id', req.userId)
        .single();

      if (fetchError || !currentUser) {
        return res.status(404).json({ status: 'error', message: 'User not found' });
      }

      const nextProfile = {
        ...(currentUser.profile || {}),
        profilePhotoUrl: url,
        profilePhotoUpdatedAt: new Date().toISOString()
      };

      const { error: updateError } = await supabase
        .from('users')
        .update({ profile: nextProfile })
        .eq('id', req.userId);

      if (updateError) {
        throw updateError;
      }

      return res.json({
        status: 'success',
        profilePhotoUrl: url
      });
    } catch (error) {
      console.error('Profile photo upload error:', error);
      if (error?.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          status: 'error',
          message: `Image is too large. Maximum size is ${PROFILE_PHOTO_MAX_SIZE_LABEL}.`
        });
      }
      return res.status(500).json({
        status: 'error',
        message: isProduction() ? 'Failed to upload profile photo' : (error?.message || 'Failed to upload profile photo')
      });
    } finally {
      if (tempPath) {
        try {
          await fs.promises.unlink(tempPath);
        } catch (cleanupError) {
          console.error('Failed to cleanup temp profile photo:', cleanupError);
        }
      }
    }
  });

  router.delete('/photo', authenticateToken, async (req, res) => {
    try {
      const { data: currentUser, error: fetchError } = await supabase
        .from('users')
        .select('id, profile')
        .eq('id', req.userId)
        .single();

      if (fetchError || !currentUser) {
        return res.status(404).json({ status: 'error', message: 'User not found' });
      }

      const nextProfile = { ...(currentUser.profile || {}) };
      delete nextProfile.profilePhotoUrl;
      delete nextProfile.profilePhotoUpdatedAt;

      const { error: updateError } = await supabase
        .from('users')
        .update({ profile: nextProfile })
        .eq('id', req.userId);

      if (updateError) {
        throw updateError;
      }

      return res.json({ status: 'success', profilePhotoUrl: '' });
    } catch (error) {
      console.error('Profile photo delete error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to remove profile photo'
      });
    }
  });
}
