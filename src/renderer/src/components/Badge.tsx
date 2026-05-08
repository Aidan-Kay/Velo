/**
 * App-specific Badge component with custom status variants.
 * Intentionally separate from ui/badge.tsx to survive shadcn component updates.
 */

import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import React from "react";

const badgeVariants = cva("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium leading-5 border", {
  variants: {
    variant: {
      default: "bg-secondary/20 text-secondary-foreground border-secondary/30",
      active: "bg-green-500/20 text-green-400 border-green-500/30",
      draft: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      sold: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      processing: "bg-purple-500/20 text-purple-400 border-purple-500/30",
      hidden: "bg-neutral-600/20 text-neutral-400 border-neutral-600/30",
      ignored: "bg-neutral-600/20 text-neutral-400 border-neutral-600/30",
      "needs-action": "bg-red-500/20 text-red-400 border-red-500/30",
      waiting: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      complete: "bg-green-500/20 text-green-400 border-green-500/30",
      "label-sent": "bg-purple-500/20 text-purple-400 border-purple-500/30",
      "label-failed": "bg-red-500/20 text-red-400 border-red-500/30",
      shipped: "bg-sky-500/20 text-sky-400 border-sky-500/30",
      completed: "bg-green-500/20 text-green-400 border-green-500/30",
      "awaiting-pickup": "bg-orange-500/20 text-orange-400 border-orange-500/30",
      pending: "bg-orange-500/20 text-orange-400 border-orange-500/30",
      countered: "bg-amber-500/20 text-amber-400 border-amber-500/30",
      cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
