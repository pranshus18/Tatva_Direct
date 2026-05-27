import React from 'react';
import { cn } from '@/lib/utils';

export default function SpPageHeader({
  title,
  description,
  icon: Icon,
  actions,
  className
}) {
  return (
    <div className={cn('mb-6 border-b border-border/80 pb-6', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            {Icon ? (
              <div className="sp-page-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-sm">
                <Icon className="h-6 w-6" />
              </div>
            ) : null}
            <div>
              {title ? (
                <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
              ) : null}
              {description ? (
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground sm:text-base">{description}</p>
              ) : null}
            </div>
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
