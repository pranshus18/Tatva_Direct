/**
 * Supabase Storage Service
 * Handles file uploads to Supabase Storage
 */

import { supabase } from '../config/supabase.js';

/** Bucket for order PDFs and attachments (must exist in Supabase Storage). Override via env if you use a different name. */
export const ORDER_ATTACHMENTS_BUCKET = (
  process.env.SUPABASE_STORAGE_ORDER_BUCKET || 'order-attachments'
).trim();
export const PRODUCT_IMAGES_BUCKET = (
  process.env.SUPABASE_STORAGE_PRODUCT_BUCKET || 'product-images'
).trim();

const bucketEnsureCache = new Set();

const ensureBucketIsPublic = async (bucket) => {
  if (!bucket || bucketEnsureCache.has(bucket)) return;

  try {
    const { data: existingBucket, error: getError } = await supabase.storage.getBucket(bucket);

    if (getError) {
      const msg = String(getError.message || '').toLowerCase();
      const notFound = msg.includes('not found') || msg.includes('does not exist');
      if (!notFound) {
        throw new Error(`Storage bucket lookup failed: ${getError.message}`);
      }

      const { error: createError } = await supabase.storage.createBucket(bucket, {
        public: true,
        fileSizeLimit: 10485760
      });
      if (createError) {
        throw new Error(`Storage bucket create failed: ${createError.message}`);
      }
    } else if (existingBucket && existingBucket.public !== true) {
      const { error: updateError } = await supabase.storage.updateBucket(bucket, {
        public: true,
        fileSizeLimit: existingBucket.file_size_limit || 10485760,
        allowedMimeTypes: existingBucket.allowed_mime_types || null
      });
      if (updateError) {
        throw new Error(`Storage bucket update failed: ${updateError.message}`);
      }
    }

    bucketEnsureCache.add(bucket);
  } catch (error) {
    console.error(`Failed to ensure bucket "${bucket}" is public:`, error);
    throw error;
  }
};

/**
 * Upload file to Supabase Storage
 * @param {string} bucket - Storage bucket name
 * @param {string} path - File path within bucket (e.g., 'product-images/product-id/filename.jpg')
 * @param {Buffer|File} file - File data
 * @param {object} options - Upload options
 * @returns {Promise<{url: string, path: string}>}
 */
export const uploadFile = async (bucket, path, file, options = {}) => {
  try {
    await ensureBucketIsPublic(bucket);

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        contentType: options.contentType || 'application/octet-stream',
        upsert: options.upsert || false,
        ...options
      });

    if (error) {
      const message = String(error.message || '');
      if (message.toLowerCase().includes('bucket not found')) {
        throw new Error(
          `Storage upload error: Bucket not found ("${bucket}"). Create this bucket in Supabase Storage or set the correct bucket name in env.`
        );
      }
      throw new Error(`Storage upload error: ${message}`);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);

    return {
      url: urlData.publicUrl,
      path: data.path
    };
  } catch (error) {
    console.error('File upload error:', error);
    throw error;
  }
};

/**
 * Delete file from Supabase Storage
 * @param {string} bucket - Storage bucket name
 * @param {string} path - File path to delete
 */
export const deleteFile = async (bucket, path) => {
  try {
    const { error } = await supabase.storage
      .from(bucket)
      .remove([path]);

    if (error) {
      throw new Error(`Storage delete error: ${error.message}`);
    }
  } catch (error) {
    console.error('File delete error:', error);
    throw error;
  }
};

/**
 * Get public URL for a file
 * @param {string} bucket - Storage bucket name
 * @param {string} path - File path
 * @returns {string} Public URL
 */
export const getPublicUrl = (bucket, path) => {
  const { data } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);
  
  return data.publicUrl;
};

/**
 * Upload product image
 * @param {string} productId - Product ID
 * @param {Buffer|File} file - Image file
 * @param {string} filename - Original filename
 * @returns {Promise<string>} Public URL of uploaded image
 */
export const uploadProductImage = async (productId, file, filename) => {
  const extension = filename.split('.').pop();
  const path = `${productId}/${Date.now()}-${filename}`;
  
  const { url } = await uploadFile(PRODUCT_IMAGES_BUCKET, path, file, {
    contentType: `image/${extension}`,
    upsert: false
  });
  
  return url;
};

/**
 * Upload BOQ file
 * @param {string} boqId - BOQ ID
 * @param {Buffer|File} file - File data
 * @param {string} filename - Original filename
 * @returns {Promise<{url: string, path: string}>}
 */
export const uploadBOQFile = async (boqId, file, filename) => {
  const path = `${boqId}/${Date.now()}-${filename}`;
  
  return await uploadFile('boq-files', path, file, {
    contentType: 'application/pdf',
    upsert: false
  });
};

/**
 * Upload order attachment
 * @param {string} orderId - Order ID
 * @param {Buffer|File} file - File data
 * @param {string} filename - Original filename
 * @returns {Promise<{url: string, path: string}>}
 */
export const uploadOrderAttachment = async (orderId, file, filename) => {
  const extension = filename.split('.').pop();
  const path = `${orderId}/${Date.now()}-${filename}`;
  
  const contentType = extension === 'pdf' 
    ? 'application/pdf' 
    : `application/${extension}`;
  
  return await uploadFile(ORDER_ATTACHMENTS_BUCKET, path, file, {
    contentType,
    upsert: false
  });
};

export default {
  ORDER_ATTACHMENTS_BUCKET,
  PRODUCT_IMAGES_BUCKET,
  uploadFile,
  deleteFile,
  getPublicUrl,
  uploadProductImage,
  uploadBOQFile,
  uploadOrderAttachment
};
