import type { DocsThemeConfig } from "nextra-theme-docs";

const config: DocsThemeConfig = {
  logo: (
    <span style={{ fontWeight: 800, fontSize: 18 }}>
      vaultctl
    </span>
  ),
  project: {
    link: "https://github.com/vineethkrishnan/vaultctl",
  },
  docsRepositoryBase:
    "https://github.com/vineethkrishnan/vaultctl/tree/main/docs-site",
  footer: {
    text: (
      <span>
        {new Date().getFullYear()} © vaultctl — Zero-knowledge password vault
      </span>
    ),
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="description" content="vaultctl — Zero-knowledge, self-hosted password vault" />
      <meta name="og:title" content="vaultctl Documentation" />
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
