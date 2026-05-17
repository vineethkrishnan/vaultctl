// Apply theme before React mounts so pre-auth pages (login, register,
// recovery kit) render with the user's preference instead of falling back to
// the CSS dark default. Kept as an external file because the CSP forbids
// inline scripts. useTheme keeps localStorage in sync after mount.
(function () {
  try {
    var stored = localStorage.getItem("vaultctl_theme");
    var theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    document.documentElement.classList.add(theme);
  } catch (e) {}
})();
