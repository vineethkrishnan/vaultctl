import type { DocsThemeConfig } from "nextra-theme-docs";

const config: DocsThemeConfig = {
  logo: (
    <span aria-label="VaultCTL" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="brand-mark" style={{ fontSize: 26, color: "#2dd4bf" }}>
        {""}
      </span>
      <span className="brand-mark" style={{ fontSize: 19 }}>
        {""}
      </span>
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
          <a href="https://github.com/vineethkrishnan/vaultctl/pkgs/container/vaultctl" target="_blank" rel="noopener" style={{ color: "inherit", textDecoration: "none", opacity: 0.7 }}>Container</a>
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
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
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
