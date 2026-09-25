import { useState } from "react";
import { X } from "lucide-react";

// A box where each word becomes a removable "chip".
// Enter or comma adds the word; Backspace on an empty box removes the last one.
export default function KeywordInput({
  value,
  onChange,
  placeholder = "Type a word, then press Enter",
  invalid = false,
}) {
  const [text, setText] = useState("");

  function add() {
    const word = text.trim().toLowerCase().replace(/,$/, "");
    if (word && !value.includes(word)) onChange([...value, word]);
    setText("");
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className={`flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border bg-white px-2 py-1.5 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 ${
        invalid ? "border-red-400" : "border-line"
      }`}
    >
      {value.map((word) => (
        <span
          key={word}
          className="flex items-center gap-1 rounded-md bg-brand/10 py-1 pl-2 pr-1 text-sm font-normal text-brand"
        >
          {word}
          <button
            type="button"
            aria-label={`Remove ${word}`}
            onClick={() => onChange(value.filter((k) => k !== word))}
            className="cursor-pointer rounded p-0.5 hover:bg-brand/20"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={add}
        enterKeyHint="done"
        placeholder={value.length ? "Add another..." : placeholder}
        className="min-w-32 flex-1 bg-transparent px-1 py-1 text-base font-normal placeholder:text-muted focus:outline-none sm:text-sm"
      />
    </div>
  );
}
