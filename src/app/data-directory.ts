import { access, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

export const productName = "captain-slop";
const legacyProductName = ["t", "code"].join("");

export async function ensureDataDirectory(base: string): Promise<string> {
  const current = join(base, productName);
  try {
    await access(current);
    return current;
  } catch {
    // The current product directory has not been created yet.
  }

  await mkdir(base, { recursive: true });
  try {
    await rename(join(base, legacyProductName), current);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(current, { recursive: true });
  }
  return current;
}
