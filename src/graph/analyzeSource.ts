import ts from "typescript";
import type { CallSite } from "../shared/viewData";

export interface ImportRecord {
  specifier: string;
  line: number;
  text: string;
  /** local names this import binds */
  names: string[];
  typeOnly: boolean;
  /** import() or require() */
  dynamic: boolean;
}

export interface SourceAnalysis {
  path: string;
  lineCount: number;
  imports: ImportRecord[];
  exports: string[];
  publicMethods: string[];
  hasDocComment: boolean;
  /** imported name -> lines in this file that use it */
  usage: Record<string, CallSite[]>;
}

export function analyzeSource(path: string, text: string): SourceAnalysis {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindFor(path));
  const sourceLines = text.split(/\r?\n/);
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const textOf = (line: number) => (sourceLines[line - 1] ?? "").trim().slice(0, 100);

  const imports: ImportRecord[] = [];
  const exports: string[] = [];
  const publicMethods: string[] = [];
  let hasDocComment = false;
  const addImport = (specifier: string, node: ts.Node, names: string[], typeOnly: boolean, dynamic: boolean) => {
    const line = lineOf(node);
    imports.push({ specifier, line, text: textOf(line), names, typeOnly, dynamic });
  };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      addImport(statement.moduleSpecifier.text, statement, importedNames(statement.importClause), isTypeOnlyImport(statement.importClause), false);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      addImport(statement.moduleSpecifier.text, statement, [], statement.isTypeOnly, false);
    } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference) && ts.isStringLiteral(statement.moduleReference.expression)) {
      addImport(statement.moduleReference.expression.text, statement, [statement.name.text], statement.isTypeOnly, false);
    }
    collectExports(statement, exports, publicMethods);
    if (!hasDocComment && isExported(statement)) hasDocComment = hasJsDoc(text, statement);
  }

  const importedNameSet = new Set(imports.flatMap((record) => record.names));
  const fieldTypes = fieldsTypedWithImports(source, importedNameSet);
  const usage: Record<string, CallSite[]> = {};
  const recordUsage = (name: string, node: ts.Node) => {
    const line = lineOf(node);
    const sites = (usage[name] ??= []);
    if (!sites.some((site) => site.line === line)) sites.push({ line, text: textOf(line) });
  };

  const visit = (node: ts.Node) => {
    if (isDynamicImportOrRequire(node)) addImport((node.arguments[0] as ts.StringLiteral).text, node, [], false, true);
    if (ts.isIdentifier(node) && importedNameSet.has(node.text) && !isInsideImport(node)) recordUsage(node.text, node);
    if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const typeName = fieldTypes.get(node.name.text);
      if (typeName) recordUsage(typeName, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return { path, lineCount: sourceLines.length, imports, exports, publicMethods, hasDocComment, usage };
}

function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function importedNames(clause: ts.ImportClause | undefined): string[] {
  if (!clause) return [];
  const names: string[] = [];
  if (clause.name) names.push(clause.name.text);
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
  if (bindings && ts.isNamedImports(bindings)) names.push(...bindings.elements.map((element) => element.name.text));
  return names;
}

function isTypeOnlyImport(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  if (clause.name || !bindings || !ts.isNamedImports(bindings)) return false;
  return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

function isExported(statement: ts.Statement): boolean {
  return hasModifier(statement, ts.SyntaxKind.ExportKeyword);
}

function hasJsDoc(text: string, statement: ts.Statement): boolean {
  return (ts.getLeadingCommentRanges(text, statement.getFullStart()) ?? []).some((range) => text.startsWith("/**", range.pos));
}

function collectExports(statement: ts.Statement, exports: string[], methods: string[]): void {
  if (ts.isExportAssignment(statement)) {
    exports.push("default");
    return;
  }
  if (!isExported(statement)) return;
  if (ts.isClassDeclaration(statement)) {
    exports.push(`class ${statement.name?.text ?? "default"}`);
    for (const member of statement.members) {
      const isPublic = !hasModifier(member, ts.SyntaxKind.PrivateKeyword) && !hasModifier(member, ts.SyntaxKind.ProtectedKeyword);
      if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && isPublic) methods.push(member.name.text);
    }
  } else if (ts.isFunctionDeclaration(statement)) exports.push(`function ${statement.name?.text ?? "default"}`);
  else if (ts.isInterfaceDeclaration(statement)) exports.push(`interface ${statement.name.text}`);
  else if (ts.isTypeAliasDeclaration(statement)) exports.push(`type ${statement.name.text}`);
  else if (ts.isEnumDeclaration(statement)) exports.push(`enum ${statement.name.text}`);
  else if (ts.isVariableStatement(statement)) {
    const keyword = statement.declarationList.flags & ts.NodeFlags.Const ? "const" : "let";
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) exports.push(`${keyword} ${declaration.name.text}`);
    }
  }
}

/** class fields whose type is an imported name, e.g. `private readonly documents: DocumentRepository` */
function fieldsTypedWithImports(source: ts.SourceFile, importedNames: Set<string>): Map<string, string> {
  const fields = new Map<string, string>();
  const typeNameOf = (type: ts.TypeNode | undefined) =>
    type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && importedNames.has(type.typeName.text) ? type.typeName.text : undefined;
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    for (const member of statement.members) {
      if (ts.isConstructorDeclaration(member)) {
        for (const parameter of member.parameters) {
          const typeName = typeNameOf(parameter.type);
          if (typeName && ts.isParameterPropertyDeclaration(parameter, member) && ts.isIdentifier(parameter.name)) fields.set(parameter.name.text, typeName);
        }
      }
      if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
        const typeName = typeNameOf(member.type);
        if (typeName) fields.set(member.name.text, typeName);
      }
    }
  }
  return fields;
}

function isDynamicImportOrRequire(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) return false;
  return node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require");
}

function isInsideImport(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isImportDeclaration(current) || ts.isImportEqualsDeclaration(current) || ts.isExportDeclaration(current)) return true;
  }
  return false;
}
