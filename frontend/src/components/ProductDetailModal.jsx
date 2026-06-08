import { useState } from 'react';
import { getApiUrl } from '../config/api';
import { 
  Package,
  Wallet,
  Box,
  Tag,
  Edit2,
  Check,
  Ban,
  Save,
  X
} from 'lucide-react';
import { formatRupeePerUnit } from '../utils/formatRupee';
import RupeeInput from './RupeeInput';

const IGST_OPTIONS = ['0', '5', '12', '18', '28'];
const CGST_SGST_OPTIONS = ['0', '2.5', '6', '9', '14'];

const ProductDetailModal = ({ product, supplier, onClose, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedProduct, setEditedProduct] = useState({
    ...product,
    hsnCode: product?.hsnCode || product?.hsn_code || '',
    gtin: product?.gtin || '',
    igst_rate: product?.igst_rate != null ? String(product.igst_rate) : '',
    cgst_rate: product?.cgst_rate != null ? String(product.cgst_rate) : '',
    sgst_rate: product?.sgst_rate != null ? String(product.sgst_rate) : ''
  });
  const [loading, setLoading] = useState(false);
  const [enhancingGst, setEnhancingGst] = useState(false);
  const [gstAiPrompt, setGstAiPrompt] = useState('');
  const [aiProvider, setAiProvider] = useState('auto');
  const [gstSuggestion, setGstSuggestion] = useState(null);

  const handleSave = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const productId = product.id || product._id;
      const response = await fetch(getApiUrl(`/api/admin/products/${productId}`), {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(editedProduct)
      });

      if (response.ok) {
        alert('Product updated successfully!');
        setIsEditing(false);
        if (onUpdate) onUpdate();
      } else {
        alert('Failed to update product');
      }
    } catch (error) {
      console.error('Error updating product:', error);
      alert('Error updating product');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!confirm('Are you sure you want to approve this product?')) return;
    
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const productId = product.id || product._id;
      const response = await fetch(getApiUrl(`/api/admin/products/${productId}/approve`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        alert('Product approved successfully!');
        if (onUpdate) onUpdate();
      } else {
        alert('Failed to approve product');
      }
    } catch (error) {
      console.error('Error approving product:', error);
      alert('Error approving product');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    const reason = prompt('Enter rejection reason:');
    if (!reason) return;
    
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const productId = product.id || product._id;
      const response = await fetch(getApiUrl(`/api/admin/products/${productId}/reject`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason })
      });

      if (response.ok) {
        alert('Product rejected');
        if (onUpdate) onUpdate();
      } else {
        alert('Failed to reject product');
      }
    } catch (error) {
      console.error('Error rejecting product:', error);
      alert('Error rejecting product');
    } finally {
      setLoading(false);
    }
  };

  const performAIGstFetch = async () => {
    const productToUse = isEditing ? editedProduct : product;
    if (!productToUse?.name) {
      alert('Please enter product name first');
      return;
    }

    setEnhancingGst(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/admin/products/ai-gst'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          productName: productToUse.name,
          category: productToUse.category || '',
          description: productToUse.description || '',
          hsnCode: productToUse.hsnCode || productToUse.hsn_code || '',
          prompt: gstAiPrompt || '',
          provider: aiProvider
        })
      });

      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to fetch GST rates');
      }

      const nextRates = {
        hsnCode: String(data.hsn_code || productToUse.hsnCode || productToUse.hsn_code || ''),
        sgst_rate: String(data.sgst_rate ?? ''),
        cgst_rate: String(data.cgst_rate ?? ''),
        igst_rate: String(data.igst_rate ?? '')
      };

      if (!isEditing) {
        setIsEditing(true);
      }

      setGstSuggestion({
        ...nextRates,
        confidenceTier: data.confidence_tier || 'medium',
        canAutoApply: Boolean(data.can_auto_apply),
        confidence: data.confidence || 'medium',
        reason: data.reason || ''
      });
    } catch (error) {
      console.error('AI GST fetch error:', error);
      alert(`Failed to fetch GST rates: ${error.message}`);
    } finally {
      setEnhancingGst(false);
    }
  };

  const currentProduct = isEditing ? editedProduct : product;
  const gtinValue = currentProduct?.gtin || '';
  
  const productSchema = {
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": currentProduct.name,
    "description": currentProduct.description || "Construction material for building projects",
    "sku": `PROD-${String(currentProduct.id || currentProduct._id || '000000').padStart(6, '0')}`,
    "category": currentProduct.category,
    "brand": {
      "@type": "Brand",
      "name": supplier?.company || supplier?.name || "TatvaDirect Supplier"
    },
    "offers": {
      "@type": "Offer",
      "priceCurrency": "INR",
      "price": currentProduct.price.toString(),
      "priceSpecification": {
        "@type": "UnitPriceSpecification",
        "price": currentProduct.price,
        "priceCurrency": "INR",
        "unitText": currentProduct.unit
      },
      "itemCondition": "https://schema.org/NewCondition",
      "availability": currentProduct.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      "seller": {
        "@type": "Organization",
        "name": supplier?.company || supplier?.name || "TatvaDirect Supplier"
      }
    }
  };

  const statusInfo = {
    approved: { color: '#059669', text: 'Approved' },
    pending: { color: '#d97706', text: 'Pending Approval' },
    rejected: { color: '#dc2626', text: 'Rejected' }
  };

  const status = statusInfo[product.status] || statusInfo.pending;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-content">
            <div className="modal-title-section">
              <Package size={28} color="#4f46e5" />
              {isEditing ? (
                <input
                  type="text"
                  value={editedProduct.name}
                  onChange={(e) => setEditedProduct({ ...editedProduct, name: e.target.value })}
                  className="modal-title-input"
                />
              ) : (
                <h2 className="modal-title">{product.name}</h2>
              )}
            </div>
            <div className="modal-badges">
              <span className="category-badge-modal">{currentProduct.category}</span>
              <span className={`status-badge-modal status-${product.status}`}>
                {status.text}
              </span>
            </div>
          </div>
          
          <div className="modal-actions">
            {!isEditing ? (
              <>
                <button onClick={() => setIsEditing(true)} className="btn-modal btn-edit-modal">
                  <Edit2 size={16} />
                  Edit
                </button>
                
                {product.status !== 'approved' && (
                  <button onClick={handleApprove} disabled={loading} className="btn-modal btn-approve-modal">
                    <Check size={16} />
                    Approve
                  </button>
                )}
                
                {product.status !== 'rejected' && (
                  <button onClick={handleReject} disabled={loading} className="btn-modal btn-reject-modal">
                    <Ban size={16} />
                    Reject
                  </button>
                )}
              </>
            ) : (
              <>
                <button onClick={handleSave} disabled={loading} className="btn-modal btn-save-modal">
                  <Save size={16} />
                  {loading ? 'Saving...' : 'Save'}
                </button>
                
                <button 
                  onClick={() => {
                    setIsEditing(false);
                    setEditedProduct({ ...product });
                  }} 
                  disabled={loading}
                  className="btn-modal btn-cancel-modal"
                >
                  <X size={16} />
                  Cancel
                </button>
              </>
            )}
            
            <button onClick={onClose} disabled={loading} className="btn-close-modal">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="detail-cards-grid">
            {isEditing ? (
              <>
                <div className="detail-card-editable">
                  <div className="detail-icon" style={{ background: '#7c3aed15' }}>
                    <Tag size={20} color="#7c3aed" />
                  </div>
                  <div className="detail-content-editable">
                    <label>GTIN / UPC / EAN</label>
                    <input
                      type="text"
                      value={editedProduct.gtin || ''}
                      onChange={(e) => setEditedProduct({ ...editedProduct, gtin: e.target.value.replace(/\s+/g, '') })}
                      className="detail-input"
                      placeholder="8/12/13/14 digit code"
                      inputMode="numeric"
                      autoComplete="off"
                    />
                    <span className="detail-subtitle">Product identifier</span>
                  </div>
                </div>
                <div className="detail-card-editable">
                  <div className="detail-icon" style={{ background: '#05966915' }}>
                    <Wallet size={20} color="#059669" />
                  </div>
                  <div className="detail-content-editable">
                    <label>Price (₹)</label>
                    <RupeeInput
                      type="number"
                      min="0"
                      step="0.01"
                      value={editedProduct.price}
                      onChange={(e) => setEditedProduct({ ...editedProduct, price: parseFloat(e.target.value) || 0 })}
                      inputClassName="detail-input"
                    />
                    <span className="detail-subtitle">per {editedProduct.unit}</span>
                  </div>
                </div>
                
                <div className="detail-card-editable">
                  <div className="detail-icon" style={{ background: '#4f46e515' }}>
                    <Box size={20} color="#4f46e5" />
                  </div>
                  <div className="detail-content-editable">
                    <label>Stock</label>
                    <input
                      type="number"
                      value={editedProduct.stock}
                      onChange={(e) => setEditedProduct({ ...editedProduct, stock: parseInt(e.target.value) || 0 })}
                      className="detail-input"
                    />
                    <span className="detail-subtitle">{editedProduct.unit}</span>
                  </div>
                </div>
                
                <div className="detail-card-editable">
                  <div className="detail-icon" style={{ background: '#d9770615' }}>
                    <Tag size={20} color="#d97706" />
                  </div>
                  <div className="detail-content-editable">
                    <label>Category</label>
                    <select
                      value={editedProduct.category}
                      onChange={(e) => setEditedProduct({ ...editedProduct, category: e.target.value })}
                      className="detail-select"
                    >
                      <option value="steel">Steel</option>
                      <option value="cement">Cement</option>
                      <option value="aggregates">Aggregates</option>
                      <option value="masonry">Masonry</option>
                      <option value="other">Other</option>
                    </select>
                    <label style={{ marginTop: '0.75rem' }}>Unit</label>
                    <input
                      type="text"
                      value={editedProduct.unit}
                      onChange={(e) => setEditedProduct({ ...editedProduct, unit: e.target.value })}
                      className="detail-input"
                      style={{ marginTop: '0.25rem' }}
                    />
                  </div>
                </div>
                <div className="detail-card-editable">
                  <div className="detail-icon" style={{ background: '#0f766e15' }}>
                    <Tag size={20} color="#0f766e" />
                  </div>
                  <div className="detail-content-editable">
                    <label>SGST / CGST / IGST</label>
                    <input
                      type="text"
                      value={editedProduct.hsnCode || ''}
                      onChange={(e) => setEditedProduct({ ...editedProduct, hsnCode: e.target.value })}
                      className="detail-input"
                      placeholder="HSN code (4-8 digits)"
                      style={{ marginBottom: '0.5rem' }}
                    />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(80px, 1fr))', gap: '0.5rem' }}>
                      <select
                        value={editedProduct.sgst_rate || ''}
                        onChange={(e) => setEditedProduct({ ...editedProduct, sgst_rate: e.target.value })}
                        className="detail-select"
                      >
                        <option value="">SGST</option>
                        {CGST_SGST_OPTIONS.map((rate) => (
                          <option key={`sgst-${rate}`} value={rate}>{rate}%</option>
                        ))}
                      </select>
                      <select
                        value={editedProduct.cgst_rate || ''}
                        onChange={(e) => setEditedProduct({ ...editedProduct, cgst_rate: e.target.value })}
                        className="detail-select"
                      >
                        <option value="">CGST</option>
                        {CGST_SGST_OPTIONS.map((rate) => (
                          <option key={`cgst-${rate}`} value={rate}>{rate}%</option>
                        ))}
                      </select>
                      <select
                        value={editedProduct.igst_rate || ''}
                        onChange={(e) => setEditedProduct({ ...editedProduct, igst_rate: e.target.value })}
                        className="detail-select"
                      >
                        <option value="">IGST</option>
                        {IGST_OPTIONS.map((rate) => (
                          <option key={`igst-${rate}`} value={rate}>{rate}%</option>
                        ))}
                      </select>
                    </div>
                    <span className="detail-subtitle">AI can auto-fill these GST rates below</span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="detail-card">
                  <div className="detail-icon" style={{ background: '#05966915' }}>
                    <Wallet size={20} color="#059669" />
                  </div>
                  <div className="detail-content">
                    <span className="detail-label">Price</span>
                    <span className="detail-value">{formatRupeePerUnit(currentProduct.price, currentProduct.unit)}</span>
                  </div>
                </div>
                
                <div className="detail-card">
                  <div className="detail-icon" style={{ background: '#4f46e515' }}>
                    <Box size={20} color="#4f46e5" />
                  </div>
                  <div className="detail-content">
                    <span className="detail-label">Stock Available</span>
                    <span className="detail-value">{currentProduct.stock.toLocaleString()}</span>
                    <span className="detail-subtitle">{currentProduct.unit}</span>
                  </div>
                </div>
                
                <div className="detail-card">
                  <div className="detail-icon" style={{ background: '#d9770615' }}>
                    <Tag size={20} color="#d97706" />
                  </div>
                  <div className="detail-content">
                    <span className="detail-label">SKU</span>
                    <span className="detail-value">PROD-{String(currentProduct.id || currentProduct._id || '000000').padStart(6, '0')}</span>
                    <span className="detail-subtitle">Product Code</span>
                  </div>
                </div>

                <div className="detail-card">
                  <div className="detail-icon" style={{ background: '#7c3aed15' }}>
                    <Tag size={20} color="#7c3aed" />
                  </div>
                  <div className="detail-content">
                    <span className="detail-label">GTIN / UPC / EAN</span>
                    <span className="detail-value">{gtinValue || 'N/A'}</span>
                    <span className="detail-subtitle">Product identifier</span>
                  </div>
                </div>
                <div className="detail-card">
                  <div className="detail-icon" style={{ background: '#0f766e15' }}>
                    <Tag size={20} color="#0f766e" />
                  </div>
                  <div className="detail-content">
                    <span className="detail-label">GST Rates</span>
                    <span className="detail-value">
                      HSN {currentProduct.hsnCode || currentProduct.hsn_code || 'N/A'} | SGST {currentProduct.sgst_rate != null ? `${currentProduct.sgst_rate}%` : 'N/A'} | CGST {currentProduct.cgst_rate != null ? `${currentProduct.cgst_rate}%` : 'N/A'} | IGST {currentProduct.igst_rate != null ? `${currentProduct.igst_rate}%` : 'N/A'}
                    </span>
                    <span className="detail-subtitle">Tax configuration</span>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="description-section">
            <h3>Description</h3>
            {isEditing ? (
              <textarea
                value={editedProduct.description || ''}
                onChange={(e) => setEditedProduct({ ...editedProduct, description: e.target.value })}
                className="description-textarea"
                placeholder="Enter product description..."
              />
            ) : (
              <p>{currentProduct.description || 'No description available'}</p>
            )}
          </div>

          {isEditing && (
            <div className="description-section">
              <h3 style={{ marginBottom: '0.75rem' }}>GST AI Chat</h3>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value)}
                  disabled={enhancingGst}
                  style={{ padding: '0.45rem 0.5rem', borderRadius: '6px', border: '1px solid #d1d5db', minWidth: '150px' }}
                >
                  <option value="auto">Auto (Best Available)</option>
                  <option value="openai">ChatGPT</option>
                  <option value="gemini">Gemini</option>
                  <option value="claude">Claude</option>
                </select>
                <input
                  type="text"
                  value={gstAiPrompt}
                  onChange={(e) => setGstAiPrompt(e.target.value)}
                  placeholder="Optional context (HSN/product type)"
                  style={{
                    flex: '1',
                    minWidth: '220px',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px'
                  }}
                />
                <button
                  type="button"
                  onClick={performAIGstFetch}
                  disabled={enhancingGst}
                  style={{
                    padding: '0.5rem 0.875rem',
                    background: enhancingGst ? '#9ca3af' : '#0f766e',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: '600',
                    cursor: enhancingGst ? 'not-allowed' : 'pointer'
                  }}
                >
                  {enhancingGst ? 'Fetching GST...' : 'AI Fill GST'}
                </button>
              </div>
              {gstSuggestion && (
                <div style={{
                  marginTop: '0.65rem',
                  padding: '0.65rem 0.75rem',
                  border: '1px solid #99f6e4',
                  background: '#f0fdfa',
                  borderRadius: '8px'
                }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0f766e' }}>
                    Suggested HSN/GST: HSN {gstSuggestion.hsnCode || 'N/A'} | SGST {gstSuggestion.sgst_rate}% | CGST {gstSuggestion.cgst_rate}% | IGST {gstSuggestion.igst_rate}%
                  </div>
                  <div style={{ marginTop: '0.25rem', fontSize: '0.78rem', color: '#334155' }}>
                    Tier: {gstSuggestion.confidenceTier} | {' '}
                    Confidence: {gstSuggestion.confidence}
                    {gstSuggestion.reason ? ` - ${gstSuggestion.reason}` : ''}
                  </div>
                  <div style={{ marginTop: '0.55rem', display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      disabled={!gstSuggestion.canAutoApply}
                      onClick={() => {
                        setEditedProduct((prev) => ({
                          ...prev,
                          hsnCode: gstSuggestion.hsnCode || prev.hsnCode || '',
                          sgst_rate: gstSuggestion.sgst_rate,
                          cgst_rate: gstSuggestion.cgst_rate,
                          igst_rate: gstSuggestion.igst_rate
                        }));
                        setGstSuggestion(null);
                      }}
                      style={{
                        padding: '0.4rem 0.65rem',
                        borderRadius: '6px',
                        border: 'none',
                        background: gstSuggestion.canAutoApply ? '#0f766e' : '#94a3b8',
                        color: 'white',
                        fontWeight: '600',
                        cursor: gstSuggestion.canAutoApply ? 'pointer' : 'not-allowed'
                      }}
                    >
                      {gstSuggestion.canAutoApply ? 'Use Suggested HSN + GST' : 'Review Required (Not Auto-Applicable)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setGstSuggestion(null)}
                      style={{
                        padding: '0.4rem 0.65rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: 'white',
                        color: '#334155',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {supplier && (
            <div className="supplier-section">
              <h3>Supplier Information</h3>
              <div className="supplier-info-card">
                <div className="supplier-avatar-modal">
                  {(supplier.name || 'S').charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="supplier-name-modal">{supplier.name}</div>
                  <div className="supplier-company-modal">{supplier.company || supplier.email}</div>
                </div>
              </div>
            </div>
          )}

          <div className="schema-section">
            <div className="schema-header">
              <h3>Schema.org Structured Data</h3>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(productSchema, null, 2));
                  alert('Schema copied to clipboard!');
                }}
                className="btn-copy-schema"
              >
                Copy JSON
              </button>
            </div>
            <pre className="schema-code">
              <code>{JSON.stringify(productSchema, null, 2)}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetailModal;
