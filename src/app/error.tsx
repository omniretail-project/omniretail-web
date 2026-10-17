"use client";

import { PageErrorState } from "@/shared/components/PageErrorState";

export default function Error({ reset }: { reset: () => void }) {
  return <PageErrorState onRetry={reset} />;
}
