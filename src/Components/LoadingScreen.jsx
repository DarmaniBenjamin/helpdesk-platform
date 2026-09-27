// Shown for a moment when the app opens, while it checks with the server
// whether you're already signed in
export default function LoadingScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-page">
      <div className="flex flex-col items-center gap-3">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-brand/20 border-t-brand" />
        <p className="text-sm text-muted">Loading…</p>
      </div>
    </div>
  );
}
