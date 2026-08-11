import React from 'react';
import customerProfileIcon from '@/images/customer-profile-icon.png';
import { cn } from '@/lib/utils';

/** Default customer/profile person mark used when no photo is set. */
export default function CustomerProfileIcon({ className, alt = '', ...props }) {
  return (
    <img
      src={customerProfileIcon}
      alt={alt}
      className={cn('object-contain', className)}
      draggable={false}
      {...props}
    />
  );
}
