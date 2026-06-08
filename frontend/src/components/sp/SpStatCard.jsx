import React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

export default function SpStatCard({ label, value, hint, icon: Icon, accent = 'sky', className }) {
  const accents = {
    sky: 'from-[#e0f2fe] to-white border-[#dbe7f5] text-[#0369a1]',
    indigo: 'from-[#e0f2fe] to-white border-[#dbe7f5] text-[#0369a1]',
    emerald: 'from-[#ecfdf5] to-white border-[#dbe7f5] text-[#047857]',
    amber: 'from-[#fffbeb] to-white border-[#dbe7f5] text-[#b45309]',
    rose: 'from-[#fef2f2] to-white border-[#dbe7f5] text-[#b91c1c]'
  };

  return (
    <Card className={cn('overflow-hidden border bg-gradient-to-br shadow-sm', accents[accent] || accents.sky, className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
            {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
          </div>
          {Icon ? (
            <div className="rounded-xl bg-background/80 p-2.5 shadow-sm">
              <Icon className="h-5 w-5" />
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
