import React from 'react';
import SpPageLayout from './SpPageLayout';
import SpPageHeader from './SpPageHeader';

export default function SpWorkflowPage({
  title,
  description,
  icon,
  actions,
  showStepper = false,
  children
}) {
  return (
    <SpPageLayout showStepper={showStepper}>
      {title ? (
        <SpPageHeader
          title={title}
          description={description}
          icon={icon}
          actions={actions}
        />
      ) : null}
      {children}
    </SpPageLayout>
  );
}
