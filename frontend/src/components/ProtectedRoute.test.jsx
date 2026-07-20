import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import ProtectedRoute from './ProtectedRoute';

function renderProtectedRoute(isAuthenticated) {
  return render(
    <MemoryRouter initialEntries={['/private']}>
      <Routes>
        <Route path="/pm-auth" element={<div>PM Auth Page</div>} />
        <Route
          path="/private"
          element={
            <ProtectedRoute isAuthenticated={isAuthenticated}>
              <div>Private Content</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders protected content when authenticated', () => {
    renderProtectedRoute(true);
    expect(screen.getByText('Private Content')).toBeInTheDocument();
  });

  it('redirects to PM auth when unauthenticated', () => {
    renderProtectedRoute(false);
    expect(screen.getByText('PM Auth Page')).toBeInTheDocument();
  });
});
