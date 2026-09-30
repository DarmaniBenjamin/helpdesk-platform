// Shown in the page area for the moment a page is still downloading the
// first time it's opened (see App.jsx). It waits a fifth of a second
// before appearing, so on a quick connection you never see it at all.
export default function PageLoading() {
  return (
    <div className="animate-fade-in wait-3 flex min-h-[50vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand/20 border-t-brand" />
    </div>
  );
}
