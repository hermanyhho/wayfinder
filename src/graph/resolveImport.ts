import { builtinModules } from "node:module";
import ts from "typescript";

export interface ResolveHost {
  fileExists(path: string): boolean;
  readFile(path: string): string | undefined;
}

export type Resolution = { kind: "file"; path: string } | { kind: "package"; name: string } | { kind: "builtin" } | { kind: "unresolved" };

const BUILTINS = new Set(builtinModules);

export function createResolver(root: string, options: ts.CompilerOptions, host: ResolveHost) {
  const cache = ts.createModuleResolutionCache(root, (fileName) => fileName, options);
  return (specifier: string, fromAbsolutePath: string): Resolution => {
    if (specifier.startsWith("node:") || BUILTINS.has(specifier)) return { kind: "builtin" };
    const resolved = ts.resolveModuleName(specifier, fromAbsolutePath, options, host, cache).resolvedModule;
    if (resolved && !resolved.isExternalLibraryImport && !resolved.resolvedFileName.includes("/node_modules/")) {
      return { kind: "file", path: resolved.resolvedFileName };
    }
    const name = packageName(specifier);
    return name ? { kind: "package", name } : { kind: "unresolved" };
  };
}

function packageName(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return undefined;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts[0].length > 1 && parts[1] ? `${parts[0]}/${parts[1]}` : undefined;
  return parts[0] || undefined;
}
