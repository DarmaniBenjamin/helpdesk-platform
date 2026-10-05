import { useRef } from "react";
import {
  Paperclip,
  X,
  FileText,
  FileArchive,
  FileImage,
  FileVideo,
  FileSpreadsheet,
  File,
  Download,
} from "lucide-react";
import { ACCEPT, fileUrl, formatSize } from "./useAttachments";
import Droplets from "./Droplets";

// An icon that fits the kind of file
function iconFor(name) {
  const ending = name.split(".").pop().toLowerCase();
  if (["zip", "7z", "rar", "gz"].includes(ending)) return FileArchive;
  if (["mp4", "mov", "webm"].includes(ending)) return FileVideo;
  if (["xls", "xlsx", "csv", "ods"].includes(ending)) return FileSpreadsheet;
  if (["heic", "heif"].includes(ending)) return FileImage;
  if (["pdf", "txt", "log", "doc", "docx", "rtf", "odt"].includes(ending))
    return FileText;
  return File;
}

// The paperclip button. `attach` is what useAttachments() returns.
export function AttachButton({ attach, disabled = false, className = "" }) {
  const input = useRef(null);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current.click()}
        disabled={disabled}
        className={`flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-sm text-muted transition hover:bg-brand/10 hover:text-brand active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <Paperclip className="h-4 w-4" />
        Attach files
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        onChange={(e) => {
          attach.add(e.target.files);
          e.target.value = ""; // so the same file can be picked again
        }}
        className="hidden"
      />
    </>
  );
}

// The files picked so far (before sending), each with an X to take it
// off, plus "Uploading…" and any problem
export function AttachmentChips({ attach }) {
  if (!attach.files.length && !attach.uploading && !attach.error) return null;
  return (
    <div className="flex flex-col gap-2">
      {(attach.files.length > 0 || attach.uploading > 0) && (
        <ul className="flex flex-wrap gap-2">
          {attach.files.map((f) => {
            const Icon = iconFor(f.name);
            return (
              <li
                key={f.id}
                className="flex max-w-full items-center gap-2 rounded-lg border border-line bg-page py-1.5 pl-2.5 pr-1 text-sm"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted" />
                <span className="min-w-0 truncate">{f.name}</span>
                <span className="shrink-0 text-xs text-muted">
                  {formatSize(f.size)}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => attach.remove(f.id)}
                  className="cursor-pointer rounded p-1 text-muted transition hover:bg-red-50 hover:text-red-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
          {attach.uploading > 0 && (
            <li className="flex items-center gap-2 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-sm text-muted">
              <Droplets className="h-4 w-4" />
              Uploading {attach.uploading} file
              {attach.uploading === 1 ? "" : "s"}…
            </li>
          )}
        </ul>
      )}
      {attach.error && (
        <p role="alert" className="text-sm text-red-500">
          {attach.error}
        </p>
      )}
    </div>
  );
}

// The files on a message: photos as small pictures (click to open full
// size), other files as a row with their name and size (click to
// download). `onColor`: the message is on a coloured bubble.
export function AttachmentList({ files, onColor = false }) {
  if (!files?.length) return null;
  const images = files.filter((f) => f.image);
  const others = files.filter((f) => !f.image);

  return (
    <div className="mt-3 flex flex-col gap-2">
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {images.map((f) => (
            <li key={f.id}>
              <a
                href={fileUrl(f.id)}
                target="_blank"
                rel="noreferrer"
                title={`${f.name} · ${formatSize(f.size)}`}
                className="block overflow-hidden rounded-lg border border-line bg-page transition hover:opacity-90"
              >
                <img
                  src={fileUrl(f.id)}
                  alt={f.name}
                  loading="lazy"
                  className="h-28 w-28 object-cover sm:h-32 sm:w-32"
                />
              </a>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {others.map((f) => {
            const Icon = iconFor(f.name);
            return (
              <li key={f.id}>
                <a
                  href={fileUrl(f.id)}
                  download={f.name}
                  className={`flex max-w-sm items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition ${
                    onColor
                      ? "border-white/30 bg-white/10 hover:bg-white/20"
                      : "border-line bg-white hover:border-brand/40 hover:text-brand"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{f.name}</span>
                    <span
                      className={`block text-xs ${onColor ? "text-white/80" : "text-muted"}`}
                    >
                      {formatSize(f.size)}
                    </span>
                  </span>
                  <Download className="h-4 w-4 shrink-0" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
