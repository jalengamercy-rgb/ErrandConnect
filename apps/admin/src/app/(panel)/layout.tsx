import { Suspense } from 'react';
import { Shell } from '@/components/shell';
import { Loading } from '@/components/ui';

// The panel reads the URL (current page, record IDs) in the browser, so it
// renders inside Suspense rather than being prerendered.
export default function PanelLayout({ children }: LayoutProps<'/'>) {
  return (
    <Suspense fallback={<Loading />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
