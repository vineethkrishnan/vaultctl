import type { DocsThemeConfig } from "nextra-theme-docs";

const config: DocsThemeConfig = {
  logo: (
    <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 18 }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="24" height="24" rx="6" fill="currentColor" />
        <path d="M12 6a3 3 0 00-3 3v2H8a1 1 0 00-1 1v5a1 1 0 001 1h8a1 1 0 001-1v-5a1 1 0 00-1-1h-1V9a3 3 0 00-3-3zm-1 5V9a1 1 0 112 0v2h-2z" fill="white" />
      </svg>
      vaultctl
    </span>
  ),
  project: {
    link: "https://github.com/vineethkrishnan/vaultctl",
  },
  docsRepositoryBase:
    "https://github.com/vineethkrishnan/vaultctl/tree/main/docs-site",
  primaryHue: 217,
  primarySaturation: 91,
  footer: {
    text: (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", gap: 8 }}>
        <div style={{ display: "flex", gap: 16, fontSize: 14 }}>
          <a href="https://github.com/vineethkrishnan/vaultctl" target="_blank" rel="noopener" style={{ color: "inherit", textDecoration: "none", opacity: 0.7 }}>GitHub</a>
          <a href="https://hub.docker.com/r/vineethnkrishnan/vaultctl" target="_blank" rel="noopener" style={{ color: "inherit", textDecoration: "none", opacity: 0.7 }}>Docker Hub</a>
          <a href="https://github.com/vineethkrishnan/vaultctl/releases" target="_blank" rel="noopener" style={{ color: "inherit", textDecoration: "none", opacity: 0.7 }}>Releases</a>
        </div>
        <span style={{ fontSize: 13, opacity: 0.5 }}>
          {new Date().getFullYear()} © vaultctl — Zero-knowledge password vault
        </span>
      </div>
    ),
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="description" content="vaultctl — Zero-knowledge, self-hosted password vault" />
      <meta name="og:title" content="vaultctl Documentation" />
      <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' rx='6' fill='%230f172a'/><path d='M12 6a3 3 0 00-3 3v2H8a1 1 0 00-1 1v5a1 1 0 001 1h8a1 1 0 001-1v-5a1 1 0 00-1-1h-1V9a3 3 0 00-3-3zm-1 5V9a1 1 0 112 0v2h-2z' fill='white'/></svg>" />
    </>
  ),
  useNextSeoProps() {
    return { titleTemplate: "%s — vaultctl docs" };
  },
  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },
  toc: {
    backToTop: true,
  },
  navigation: true,
  editLink: {
    text: "Edit this page on GitHub →",
  },
  feedback: {
    content: "Question? Give us feedback →",
    labels: "feedback",
  },
};

export default config;
