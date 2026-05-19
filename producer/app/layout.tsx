import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import ThemeRegistry from '@/lib/ThemeRegistry';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Shipping Task Producer',
  description: 'Demo app for shipping task processing',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full bg-gray-50">
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
