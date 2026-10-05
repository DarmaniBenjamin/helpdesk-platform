import Droplets from "./Droplets";

// Shown in the page area for the moment a page is still downloading the
// first time it's opened (see App.jsx). It waits a fifth of a second
// before appearing, so on a quick connection you never see it at all.
export default function PageLoading() {
  return (
    <div className="animate-fade-in wait-3 flex min-h-[50vh] items-center justify-center">
      <Droplets className="h-10 w-10 text-brand" />
    </div>
  );
}
