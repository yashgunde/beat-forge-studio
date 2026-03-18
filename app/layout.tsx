import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'YGBeatz',
  description: 'YGBeatz — Professional Browser DAW with AI Beat Generation',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-daw-bg text-daw-text overflow-hidden h-screen">
        {children}
      </body>
    </html>
  );
}
