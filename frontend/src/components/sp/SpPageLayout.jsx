import React from 'react';
import ProcurementStepper from './ProcurementStepper';

export default function SpPageLayout({ children, showStepper = false }) {
  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
      {showStepper ? <ProcurementStepper /> : null}
      {children}
    </div>
  );
}
