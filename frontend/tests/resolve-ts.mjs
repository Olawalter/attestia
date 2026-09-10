/**
 * Test-only module resolution: lets `node --test` load the app's own
 * modules, which use bundler-style imports (extensionless relative paths
 * and the `@/` alias) that Node does not resolve by itself.
 *
 *     node --import ./tests/resolve-ts.mjs --test --experimental-strip-types …
 *
 * It maps a specifier to a `.ts`/`.tsx` file that exists and changes
 * nothing else, so the code under test is the code the app ships.
 */
import { register } from "node:module";

register(
  "data:text/javascript," + encodeURIComponent(`
    import { existsSync } from "node:fs";
    import { fileURLToPath, pathToFileURL } from "node:url";
    import path from "node:path";
    const ROOT = ${JSON.stringify(process.cwd())};
    export async function resolve(specifier, context, next) {
      let base = null;
      if (specifier.startsWith("@/")) base = path.join(ROOT, specifier.slice(2));
      else if ((specifier.startsWith("./") || specifier.startsWith("../"))
               && context.parentURL?.startsWith("file:")
               && !/\\.[cm]?[jt]sx?$/.test(specifier)) {
        base = path.join(path.dirname(fileURLToPath(context.parentURL)), specifier);
      }
      if (base) {
        for (const ext of [".ts", ".tsx", "/index.ts"]) {
          if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, context);
        }
      }
      return next(specifier, context);
    }
  `),
);
