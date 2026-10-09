import React from 'react';

export const metadata = {
  title: 'Axioma - Executable Architecture Sandbox',
  description: 'Declarative State & Data Bounded Checkout Flow',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, -apple-system, sans-serif', margin: 0, padding: 0, background: '#f8fafc', color: '#0f172a' }}>
        {children}
      </body>
    </html>
  );
}
