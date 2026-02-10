export default function NotFound() {
  return (
    <div className="flex items-center justify-center h-screen bg-adytum-bg">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-adytum-accent mb-4">404</h1>
        <p className="text-adytum-text-dim">Page not found</p>
        <a href="/" className="mt-4 inline-block text-sm text-adytum-accent hover:text-adytum-accent-light">
          ← Back to Activity Feed
        </a>
      </div>
    </div>
  );
}
