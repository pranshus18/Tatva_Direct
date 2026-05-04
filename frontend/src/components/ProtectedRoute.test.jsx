import React from 'react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import ProtectedRoute from './ProtectedRoute';

function renderProtectedRoute(isAuthenticated) {
  return render(
    <MemoryRouter initialEntries={['/private']}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
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
  it('renders protected content when authenticated', () => {
    renderProtectedRoute(true);
    expect(screen.getByText('Private Content')).toBeInTheDocument();
  });

  it('redirects to login when unauthenticated', () => {
    renderProtectedRoute(false);
    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });
});
