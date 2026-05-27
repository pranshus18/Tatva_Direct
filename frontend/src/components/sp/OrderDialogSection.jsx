import React from 'react';
import { cn } from '@/lib/utils';

/** Section blocks inside `.yo-order-dialog` (Your Orders.css). */
export default function OrderDialogSection({ title, children, className }) {
  return (
    <section className={cn('yo-dialog-section', className)}>
      {title ? <h3>{title}</h3> : null}
      {children}
    </section>
  );
}
