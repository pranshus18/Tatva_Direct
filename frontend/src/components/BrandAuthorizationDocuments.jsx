import React, { useId } from 'react';
import { FileText, Loader2, Plus, X } from 'lucide-react';
import {
  certificateLabelFromUrl,
  isImageCertificateUrl,
  resolveAuthorizationCertificateUrls
} from '../utils/authorizationCertificateUrls';
import './BrandAuthorizationDocuments.css';

const CERTIFICATE_ACCEPT =
  '.pdf,.doc,.docx,image/jpeg,image/png,image/webp,image/gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export default function BrandAuthorizationDocuments({
  entry,
  editing,
  uploading,
  removingUrl,
  onUpload,
  onRemove,
  maxBytes = 15 * 1024 * 1024
}) {
  const inputId = useId();
  const urls = resolveAuthorizationCertificateUrls(entry);
  const hasDocuments = urls.length > 0;

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length || !onUpload) return;

    const tooLarge = files.find((file) => file.size > maxBytes);
    if (tooLarge) {
      alert('One or more files are too large. Maximum size is 15 MB per file.');
      return;
    }
    onUpload(files);
  };

  return (
    <div className="brand-auth-docs">
      <div className="brand-auth-docs__grid">
        {urls.map((url) => {
          const isImage = isImageCertificateUrl(url);
          const isRemoving = removingUrl === url;
          return (
            <div key={url} className="brand-auth-docs__thumb">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={`brand-auth-docs__preview${isImage ? '' : ' brand-auth-docs__preview--file'}`}
                title={certificateLabelFromUrl(url)}
              >
                {isImage ? (
                  <img src={url} alt={certificateLabelFromUrl(url)} />
                ) : (
                  <>
                    <FileText size={28} aria-hidden />
                    <span className="brand-auth-docs__file-label">{certificateLabelFromUrl(url)}</span>
                  </>
                )}
              </a>
              {editing && onRemove ? (
                <button
                  type="button"
                  className="brand-auth-docs__remove"
                  onClick={() => onRemove(url)}
                  disabled={isRemoving || uploading}
                  aria-label={`Remove ${certificateLabelFromUrl(url)}`}
                >
                  {isRemoving ? <Loader2 size={12} className="brand-auth-docs__spin" /> : <X size={12} />}
                </button>
              ) : null}
            </div>
          );
        })}

        {editing ? (
          <>
            <input
              id={inputId}
              type="file"
              accept={CERTIFICATE_ACCEPT}
              multiple
              className="brand-auth-docs__file-input"
              onChange={handleFileChange}
              disabled={uploading || !!removingUrl}
            />
            <label
              htmlFor={inputId}
              className={`brand-auth-docs__add${uploading ? ' brand-auth-docs__add--busy' : ''}`}
              title="Upload brand authorisation documents"
            >
              {uploading ? (
                <Loader2 size={22} className="brand-auth-docs__spin" aria-hidden />
              ) : (
                <Plus size={22} aria-hidden />
              )}
              <span>{uploading ? 'Uploading…' : 'Add documents'}</span>
            </label>
          </>
        ) : null}
      </div>

      {!hasDocuments && !editing ? (
        <p className="brand-auth-docs__empty">No documents uploaded</p>
      ) : null}
    </div>
  );
}
