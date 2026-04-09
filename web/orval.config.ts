import { defineConfig } from "orval";

export default defineConfig({
  vaultctl: {
    input: {
      target: "../docs/swagger.json",
      override: {
        transformer: "../scripts/strip-swagger-prefix.js",
      },
    },
    output: {
      mode: "tags-split",
      target: "./src/api",
      schemas: "./src/api/model",
      client: "react-query",
      httpClient: "fetch",
      override: {
        mutator: {
          path: "./src/lib/api-fetcher.ts",
          name: "apiFetcher",
        },
        query: {
          useQuery: true,
          useMutation: true,
          signal: true,
        },
      },
      clean: true,
    },
  },
});
