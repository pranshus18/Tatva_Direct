import React from 'react';

const AdminDashboardOverview = ({ user }) => {
  return (
    <div className="page">
      <div className="page-header">
        <h1>Admin Dashboard</h1>
        <p>Welcome{user?.name ? `, ${user.name}` : ''}. Overview widgets are loading.</p>
      </div>
    </div>
  );
};

export default AdminDashboardOverview;
