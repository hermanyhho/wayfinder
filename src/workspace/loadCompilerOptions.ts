import * as path from "node:path";
import ts from "typescript";

const NO_INPUTS_FOUND = 18003;

export function loadCompilerOptions(root: string): { options: ts.CompilerOptions; problems: string[] } {
  const fallback: ts.CompilerOptions = { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Node10, baseUrl: root };
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json") ?? ts.findConfigFile(root, ts.sys.fileExists, "jsconfig.json");
  if (!configPath) return { options: fallback, problems: [] };
  const configName = path.basename(configPath);
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    return { options: fallback, problems: [`${configName}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`] };
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
  const problems = parsed.errors
    .filter((error) => error.code !== NO_INPUTS_FOUND)
    .map((error) => `${configName}: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`);
  return { options: { ...parsed.options, allowJs: true }, problems };
}
