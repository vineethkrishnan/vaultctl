// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const withAndroidAutofill = require("../../plugins/withAndroidAutofill");

const SERVICE_NAME = ".autofill.VaultAutofillService";

interface ManifestApplication {
  $: Record<string, string>;
  service?: Array<Record<string, unknown>>;
}

function baseConfig(packageName: string | null) {
  return {
    name: "Vault CTL",
    slug: "vaultctl",
    android: packageName ? { package: packageName } : {},
    mods: undefined as unknown,
  };
}

function emptyManifest() {
  return {
    manifest: {
      application: [
        { $: { "android:name": ".MainApplication" } } as ManifestApplication,
      ],
    },
  };
}

function applyPlugin(packageName: string | null = "com.vaultctl.app") {
  const config = withAndroidAutofill(baseConfig(packageName));
  const mods = config.mods.android;
  return {
    manifest: (modResults: ReturnType<typeof emptyManifest>) =>
      mods.manifest({ ...config, modRequest: {}, modResults }),
    dangerous: (platformProjectRoot: string) =>
      mods.dangerous({
        ...config,
        modRequest: { platformProjectRoot },
        modResults: {},
      }),
  };
}

function mainApplication(
  manifest: ReturnType<typeof emptyManifest>,
): ManifestApplication {
  const application = manifest.manifest.application[0];
  if (!application) throw new Error("no application node");
  return application;
}

describe("withAndroidAutofill manifest mod", () => {
  it("declares the autofill service with the bind permission and intent filter", async () => {
    const result = await applyPlugin().manifest(emptyManifest());
    const services = mainApplication(result.modResults).service ?? [];

    expect(services).toHaveLength(1);
    const service = services[0] as Record<string, any>;
    expect(service.$["android:name"]).toBe(SERVICE_NAME);
    expect(service.$["android:permission"]).toBe(
      "android.permission.BIND_AUTOFILL_SERVICE",
    );
    expect(service.$["android:exported"]).toBe("true");
    expect(service["meta-data"][0].$["android:resource"]).toBe(
      "@xml/autofill_service",
    );
    expect(service["intent-filter"][0].action[0].$["android:name"]).toBe(
      "android.service.autofill.AutofillService",
    );
  });

  it("does not declare the service twice", async () => {
    const plugin = applyPlugin();
    const once = await plugin.manifest(emptyManifest());
    const twice = await plugin.manifest(once.modResults);

    expect(mainApplication(twice.modResults).service).toHaveLength(1);
  });
});

describe("withAndroidAutofill native sources", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "autofill-plugin-"));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  function read(relativePath: string): string {
    return fs.readFileSync(
      path.join(projectRoot, "app/src/main", relativePath),
      "utf8",
    );
  }

  it("emits the Kotlin service the manifest names, under the configured package", async () => {
    await applyPlugin().dangerous(projectRoot);

    const source = read(
      "java/com/vaultctl/app/autofill/VaultAutofillService.kt",
    );
    expect(source).toContain("package com.vaultctl.app.autofill");
    expect(source).toContain("class VaultAutofillService : AutofillService()");
  });

  it("rewrites the package so the source cannot drift from android.package", async () => {
    await applyPlugin("dev.example.fork").dangerous(projectRoot);

    const source = read(
      "java/dev/example/fork/autofill/VaultAutofillService.kt",
    );
    expect(source).toContain("package dev.example.fork.autofill");
    expect(source).toContain("import dev.example.fork.MainActivity");
    expect(source).not.toContain("com.vaultctl.app");
  });

  it("emits the resources the service and manifest reference", async () => {
    await applyPlugin().dangerous(projectRoot);

    expect(read("res/xml/autofill_service.xml")).toContain("autofill-service");
    expect(read("res/layout/autofill_unlock.xml")).toContain(
      "@string/autofill_unlock_label",
    );
    expect(read("res/values/autofill_strings.xml")).toContain(
      "autofill_unlock_label",
    );
  });

  it("fails loudly rather than generating an uncompilable package", async () => {
    await expect(applyPlugin(null).dangerous(projectRoot)).rejects.toThrow(
      /android\.package/,
    );
  });
});
