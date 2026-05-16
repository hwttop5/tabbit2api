import fs from "node:fs/promises";
import path from "node:path";

const ROOT_EXCLUDES = new Set([
  "Crashpad",
  "GrShaderCache",
  "GraphiteDawnCache",
  "ShaderCache",
  "component_crx_cache",
  "CertificateRevocation",
  "Crowd Deny",
  "MEIPreload",
  "Safe Browsing",
  "OptimizationHints",
  "PKIMetadata",
  "WasmTtsEngine",
  "Webstore Downloads",
]);

const DEFAULT_EXCLUDES = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "Media Cache",
  "DawnCache",
  "blob_storage",
  "Session Storage",
  "shared_proto_db",
]);

function shouldIgnoreCopyError(error) {
  return (
    error &&
    typeof error === "object" &&
    ["EBUSY", "EPERM", "EACCES", "ENOENT"].includes(error.code)
  );
}

async function copyPath(sourcePath, targetPath, excludedNames) {
  const basename = path.basename(sourcePath);
  if (excludedNames.has(basename)) {
    return;
  }

  const stats = await fs.stat(sourcePath);
  if (stats.isDirectory()) {
    await fs.mkdir(targetPath, { recursive: true });
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      await copyPath(
        path.join(sourcePath, entry.name),
        path.join(targetPath, entry.name),
        excludedNames,
      );
    }
    return;
  }

  try {
    await fs.copyFile(sourcePath, targetPath);
  } catch (error) {
    if (shouldIgnoreCopyError(error)) {
      console.warn(
        `[profile] skipped busy or inaccessible file: ${sourcePath} (${error.code})`,
      );
      return;
    }
    throw error;
  }
}

async function removeIfExists(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function prepareLabProfile({
  sourceUserDataDir,
  labProfileDir,
  forceRefresh = false,
}) {
  const defaultSourceDir = path.join(sourceUserDataDir, "Default");
  const defaultTargetDir = path.join(labProfileDir, "Default");

  if (forceRefresh) {
    await removeIfExists(labProfileDir);
  }

  if (!forceRefresh && (await pathExists(defaultTargetDir))) {
    return {
      defaultProfileDir: defaultTargetDir,
      labProfileDir,
    };
  }

  await fs.mkdir(labProfileDir, { recursive: true });

  const requiredRootEntries = ["Local State", "First Run", "Last Version", "Variations"];
  for (const entryName of requiredRootEntries) {
    const sourcePath = path.join(sourceUserDataDir, entryName);
    const targetPath = path.join(labProfileDir, entryName);
    try {
      const stats = await fs.stat(sourcePath);
      if (stats.isDirectory()) {
        await copyPath(sourcePath, targetPath, ROOT_EXCLUDES);
      } else {
        await fs.copyFile(sourcePath, targetPath);
      }
    } catch {
      // Optional source entry.
    }
  }

  await copyPath(defaultSourceDir, defaultTargetDir, DEFAULT_EXCLUDES);

  for (const lockName of ["LOCK", "lockfile"]) {
    await removeIfExists(path.join(labProfileDir, lockName));
    await removeIfExists(path.join(defaultTargetDir, lockName));
  }

  return {
    defaultProfileDir: defaultTargetDir,
    labProfileDir,
  };
}
