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
      <body
        style={{
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          padding: 0,
          background: '#09090b',
          color: '#f4f4f5',
          minHeight: '100vh',
        }}
      >
        {children}
      </body>
    </html>
  );
}
