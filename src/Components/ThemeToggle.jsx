import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme";

// A round sun/moon button, for the top bar and the sign-in page
export function ThemeToggleButton({ className = "" }) {
  const [theme, toggleTheme] = useTheme();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className={`group relative cursor-pointer rounded-lg p-2.5 text-muted transition hover:bg-brand/10 hover:text-brand active:scale-[0.92] sm:p-2 ${className}`}
    >
      {/* Both icons sit in the same spot; one spins out as the other spins in */}
      <span className="relative block h-5 w-5">
        <Sun
          className={`absolute inset-0 h-5 w-5 transition duration-300 ${
            dark
              ? "rotate-90 scale-0 opacity-0"
              : "rotate-0 scale-100 opacity-100"
          }`}
        />
        <Moon
          className={`absolute inset-0 h-5 w-5 transition duration-300 ${
            dark
              ? "rotate-0 scale-100 opacity-100"
              : "-rotate-90 scale-0 opacity-0"
          }`}
        />
      </span>
    </button>
  );
}

// "Dark mode" with an on/off switch, for account menus
export function ThemeSwitchRow() {
  const [theme, toggleTheme] = useTheme();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      onClick={toggleTheme}
      className="flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-sm text-muted transition hover:bg-brand/10 hover:text-brand"
    >
      {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      <span className="flex-1 text-left">Dark mode</span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          dark ? "bg-brand" : "bg-line"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-[#fff] shadow transition-all ${
            dark ? "left-4.5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
