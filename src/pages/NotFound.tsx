import React from 'react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="text-center">
        <h1 className="text-4xl font-display mb-4">404 - Not Found</h1>
        <p className="text-muted-foreground">The page you were looking for doesn't exist.</p>
      </div>
    </div>
  );
}
