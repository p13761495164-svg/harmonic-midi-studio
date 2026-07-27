import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "php-dist");

await rm(target, { recursive: true, force: true });
await mkdir(resolve(target, "public"), { recursive: true });
await cp(resolve(root, "out"), resolve(target, "public"), { recursive: true });
await cp(resolve(root, "php-server", "api"), resolve(target, "public", "api"), { recursive: true });
await cp(resolve(root, "php-server", "public.htaccess"), resolve(target, "public", ".htaccess"));
await cp(resolve(root, "php-server", "config.example.php"), resolve(target, "config.example.php"));
await cp(resolve(root, "php-server", "database.sql"), resolve(target, "database.sql"));
await cp(resolve(root, "PHP_DEPLOY.md"), resolve(target, "README.md"));

console.log(`PHP deployment package created at ${target}`);
