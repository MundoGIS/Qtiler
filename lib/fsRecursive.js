import fs from "fs";
import path from "path";

export const copyRecursive = async (source, destination) => {
  const stats = await fs.promises.stat(source);
  if (stats.isDirectory()) {
    await fs.promises.mkdir(destination, { recursive: true });
    const entries = await fs.promises.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      await copyRecursive(path.join(source, entry.name), path.join(destination, entry.name));
    }
    return;
  }
  if (stats.isFile()) {
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.copyFile(source, destination);
  }
};

export const removeRecursive = async (targetPath) => {
  await fs.promises.rm(targetPath, { recursive: true, force: true });
};
