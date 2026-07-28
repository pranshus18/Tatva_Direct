import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiUrl, authFetch } from '../config/api';
import { formatDateIST } from '../utils/dateTime';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import SpEmptyState from '../components/sp/SpEmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  FileText,
  Plus,
  Eye,
  Trash2,
  CheckCircle,
  Clock,
  RefreshCw
} from 'lucide-react';
import BoqDetailDialog from '../components/sp/BoqDetailDialog';
import './Dashboard.css';

const BoqListing = () => {
  const [boqs, setBoqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedBoq, setSelectedBoq] = useState(null);
  const navigate = useNavigate();

  const fetchBoqs = async ({ resetFilters = false } = {}) => {
    try {
      if (resetFilters) {
        setSearchTerm('');
        setStatusFilter('all');
        setSelectedBoq(null);
      }
      setLoading(true);
      setLoadError('');
      const response = await authFetch(getApiUrl('/api/boq'));
      const data = await response.json();

      if (!response.ok || data.status !== 'success') {
        setLoadError(data.message || 'Failed to fetch BOQs');
        return;
      }

      setBoqs(data.boqs || []);
    } catch (error) {
      console.error('Failed to fetch BOQs:', error);
      setLoadError('Failed to fetch BOQs. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBoqs();
  }, []);

  const handleViewBoq = (boq) => {
    if (!boq?.id) return;
    setSelectedBoq(boq);
  };

  const handleDeleteBoq = async (boqId, event) => {
    if (event) {
      event.stopPropagation();
    }
    if (!boqId) return;

    const confirmed = window.confirm(
      'Are you sure you want to delete this BOQ? This action cannot be undone and will also delete the uploaded file.'
    );
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl(`/api/boq/${boqId}`), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const data = await response.json();

      if (data.status === 'success') {
        setBoqs((prev) => prev.filter((boq) => boq.id !== boqId));
      } else {
        alert(data.message || 'Failed to delete BOQ');
      }
    } catch (error) {
      console.error('Failed to delete BOQ:', error);
      alert('Failed to delete BOQ. Please try again.');
    }
  };

  const filteredBoqs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return (boqs || [])
      .filter((boq) => {
        if (statusFilter !== 'all' && boq.status !== statusFilter) return false;
        if (!q) return true;
        return String(boq.name || '').toLowerCase().includes(q);
      })
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [boqs, searchTerm, statusFilter]);

  return (
    <SpPageLayout showStepper={false}>
      <SpPageHeader
        title="All BOQs"
        description="Browse and manage every bill of quantities you have uploaded."
        icon={FileText}
        actions={
          <>
            <Button variant="outline" onClick={() => fetchBoqs({ resetFilters: true })} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button onClick={() => navigate('/boq-normalize')}>
              <Plus className="h-4 w-4" />
              New BOQ
            </Button>
          </>
        }
      />

      {loadError ? (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : boqs.length === 0 ? (
        <SpEmptyState
          icon={FileText}
          title="No BOQs yet"
          description="Upload your first BOQ to start sourcing materials for your project."
          action={
            <Button onClick={() => navigate('/boq-normalize')}>
              <Plus className="h-4 w-4" />
              Create BOQ
            </Button>
          }
        />
      ) : (
        <div className="dashboard-section !p-0">
          <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
            <div className="min-w-[200px] flex-1">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Search</p>
              <Input
                placeholder="Search by BOQ name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Status</p>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="draft">Draft</option>
              </select>
            </div>
          </div>

          <div className="items-list">
            {filteredBoqs.length === 0 ? (
              <div className="empty-state">
                <FileText size={48} />
                <h3>No matching BOQs</h3>
                <p>Try adjusting your search or filters.</p>
              </div>
            ) : (
              filteredBoqs.map((boq) => (
                <div
                  key={boq.id}
                  className="item-card"
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleViewBoq(boq)}
                  title="Click to view BOQ items"
                >
                  <div className="item-info">
                    <h4>{boq.name}</h4>
                    <p>
                      {boq.itemCount} items • Created {formatDateIST(boq.createdAt, '—')}
                    </p>
                  </div>
                  <div className="item-status">
                    <span className={`status ${boq.status}`}>
                      {boq.status === 'completed' ? <CheckCircle size={16} /> : <Clock size={16} />}
                      {boq.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn-icon"
                      title="View BOQ"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewBoq(boq);
                      }}
                    >
                      <Eye size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={(e) => handleDeleteBoq(boq.id, e)}
                      title="Delete BOQ"
                      style={{ color: '#dc2626' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      <BoqDetailDialog
        open={Boolean(selectedBoq)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedBoq(null);
        }}
        boqId={selectedBoq?.id}
        boqName={selectedBoq?.name}
        boqStatus={selectedBoq?.status}
      />
    </SpPageLayout>
  );
};

export default BoqListing;
