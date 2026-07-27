import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "php-dist");
const appTarget = resolve(target, "apps", "harmonic-midi");

await rm(target, { recursive: true, force: true });
await mkdir(appTarget, { recursive: true });
await cp(resolve(root, "out"), appTarget, { recursive: true });
await cp(resolve(root, "php-server", "api"), resolve(appTarget, "api"), { recursive: true });
await cp(resolve(root, "php-server", "public.htaccess"), resolve(appTarget, ".htaccess"));
await cp(resolve(root, "php-server", "static-index.php"), resolve(appTarget, "index.php"));
await cp(resolve(root, "php-server", "static-index.php"), resolve(appTarget, "timbres", "index.php"));
await cp(resolve(root, "php-server", "database.sql"), resolve(target, "database.sql"));
await cp(resolve(root, "PHP_DEPLOY.md"), resolve(target, "README.md"));

console.log(`personalApp deployment package created at ${target}`);
