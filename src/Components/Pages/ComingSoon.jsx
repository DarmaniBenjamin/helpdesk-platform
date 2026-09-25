import { Hammer } from "lucide-react";

export default function ComingSoon({ title }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Hammer className="h-6 w-6" />
      </div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted">This page is coming soon.</p>
    </div>
  );
}
