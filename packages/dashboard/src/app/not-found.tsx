export default function NotFound() {
  return (
    <div className="flex items-center justify-center h-screen bg-bg-primary">
      <div className="text-center animate-fade-in">
        <h1 className="text-6xl font-bold text-accent-primary mb-3">404</h1>
        <p className="text-text-tertiary text-sm">Page not found</p>
        <a href="/" className="mt-4 inline-block text-sm text-accent-primary hover:text-accent-primary/80 transition-colors">
          ← Back to Dashboard
        </a>
      </div>
    </div>
  );
}
