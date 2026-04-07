import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: "vaultctl",
    description: "Zero-knowledge password vault",
    permissions: ["activeTab", "storage", "clipboardWrite"],
    host_permissions: ["<all_urls>"],
  },
});
