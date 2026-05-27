import React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

export default function SpEmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <Card className={cn('border-dashed', className)}>
      <CardContent className="flex flex-col items-center justify-center px-6 py-12 text-center">
        {Icon ? (
          <div className="mb-4 rounded-full bg-muted p-4 text-muted-foreground">
            <Icon className="h-8 w-8" />
          </div>
        ) : null}
        {title ? <h3 className="text-lg font-semibold text-foreground">{title}</h3> : null}
        {description ? <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p> : null}
        {action ? <div className="mt-6">{action}</div> : null}
      </CardContent>
    </Card>
  );
}
