import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PROCUREMENT_STEPS, getWorkflowStepStatus, isProcurementPath } from '@/utils/spWorkflow';

export default function ProcurementStepper() {
  const { pathname } = useLocation();
  const [status, setStatus] = useState(() => getWorkflowStepStatus());

  useEffect(() => {
    const refresh = () => setStatus(getWorkflowStepStatus());
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('sp-workflow-updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('sp-workflow-updated', refresh);
    };
  }, [pathname]);

  if (!isProcurementPath(pathname)) return null;

  const currentIndex = PROCUREMENT_STEPS.findIndex((s) => s.path === pathname);

  return (
    <nav aria-label="Procurement progress" className="mb-6 overflow-x-auto rounded-lg border bg-card/90 p-3 shadow-sm backdrop-blur-sm">
      <ol className="flex min-w-max items-center gap-1">
        {PROCUREMENT_STEPS.map((step, index) => {
          const done = status[step.id];
          const isCurrent = step.path === pathname;
          const isPast = currentIndex > index;

          return (
            <li key={step.id} className="flex items-center">
              <Link
                to={step.path}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isCurrent && 'sp-step-current',
                  !isCurrent && (isPast || done) && 'sp-step-done hover:bg-[#eef2ff]',
                  !isCurrent && !isPast && !done && 'text-muted-foreground hover:bg-muted'
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    isCurrent && 'bg-white/20 text-white',
                    !isCurrent && (done || isPast) && 'bg-[#eef2ff] text-[#4f46e5]',
                    !isCurrent && !done && !isPast && 'bg-muted text-muted-foreground'
                  )}
                >
                  {done || isPast ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <span className="hidden sm:inline">{step.label}</span>
              </Link>
              {index < PROCUREMENT_STEPS.length - 1 ? (
                <span className="mx-1 h-px w-4 bg-border sm:w-8" aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
