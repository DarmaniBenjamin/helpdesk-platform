import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { inputClass } from "./formStyles";

// A password box with a button to show or hide what's typed
export default function PasswordInput({ value, onChange, ...props }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        className={`${inputClass} pr-11`}
      />
      <button
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted transition hover:bg-brand/10 hover:text-brand"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
