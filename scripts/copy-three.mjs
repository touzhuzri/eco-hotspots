/**
 * Copy the local three package into vendor/ so the site never needs a CDN.
 * Usage: npm run vendor:three
 */
import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = resolve(root, "node_modules/three");
const to = resolve(root, "vendor/three");

mkdirSync(to, { recursive: true });
cpSync(resolve(from, "build/three.module.js"), resolve(to, "three.module.js"));
cpSync(resolve(from, "examples/jsm"), resolve(to, "addons"), {
  recursive: true,
});
console.log("three copied to vendor/three");
