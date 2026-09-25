export default function Card({ title, action, children, className = "" }) {
  return (
    <div className={`rounded-xl border border-line bg-white p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}
