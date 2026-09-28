// Picking files to attach to a reply, note or request, and uploading
// them straight away (so sending the message itself is quick).
// The same rules as the server (server/src/attachments.js), checked here
// first so people find out before waiting for an upload.
import { useState } from "react";
import { uploadFiles } from "../api";

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB each
export const MAX_FILES = 10; // per message

// The endings the server accepts, for the file picker
const ENDINGS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "heic",
  "heif",
  "bmp",
  "pdf",
  "txt",
  "log",
  "csv",
  "rtf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "eml",
  "msg",
  "zip",
  "7z",
  "rar",
  "gz",
  "mp4",
  "mov",
  "webm",
];
export const ACCEPT = ENDINGS.map((e) => `.${e}`).join(",");

const endingOf = (name) => name.split(".").pop().toLowerCase();

// "2.4 MB", "830 KB"
export function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Where to open a file. download: true saves photos instead of opening them.
export const fileUrl = (id, download = false) =>
  `/api/attachments/${id}${download ? "?download=1" : ""}`;

// The files picked for one message.
// Returns:
//   files      uploaded and ready: [{ id, name, size, image }]
//   uploading  how many are still uploading
//   error      why the last pick didn't work ("" if it did)
//   add        call with the files from a picker, a drop or a paste
//   remove     take one off (by id)
//   clear      after sending
//   ids        the IDs to send with the message
export default function useAttachments() {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");

  async function add(fileList) {
    const picked = [...fileList];
    if (picked.length === 0) return;
    setError("");

    const room = MAX_FILES - files.length - uploading;
    if (picked.length > room) {
      setError(`You can attach up to ${MAX_FILES} files to one message.`);
      return;
    }
    const wrongType = picked.find((f) => !ENDINGS.includes(endingOf(f.name)));
    if (wrongType) {
      setError(
        `"${wrongType.name}" can't be attached. Photos, PDFs, Office documents, text files, videos and zip files are fine.`,
      );
      return;
    }
    const tooBig = picked.find((f) => f.size > MAX_FILE_SIZE);
    if (tooBig) {
      setError(`"${tooBig.name}" is over 25 MB.`);
      return;
    }

    setUploading((n) => n + picked.length);
    try {
      const saved = await uploadFiles(picked);
      setFiles((list) => [...list, ...saved]);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading((n) => n - picked.length);
    }
  }

  return {
    files,
    uploading,
    error,
    add,
    remove: (id) => setFiles((list) => list.filter((f) => f.id !== id)),
    clear: () => {
      setFiles([]);
      setError("");
    },
    ids: files.map((f) => f.id),
  };
}
