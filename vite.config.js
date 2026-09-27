import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import freshdeskDevProxy from "./freshdeskDevProxy";

export default defineConfig({
  plugins: [react(), tailwindcss(), freshdeskDevProxy()],
  server: {
    // Anything the front end asks for at /api/... is passed on to the
    // backend server (the "server" folder, running on port 4000).
    // This also lets your phone reach the backend through the same
    // address it uses for the app.
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
