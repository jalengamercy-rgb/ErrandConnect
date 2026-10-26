import type { Metadata } from 'next';
import 'leaflet/dist/leaflet.css';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'ErrandCONNECT Admin',
  description: 'Operations dashboard for ErrandCONNECT',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
