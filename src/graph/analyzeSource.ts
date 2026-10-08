import ts from "typescript";
import type { CallSite, Member, MemberKind, MemberVisibility } from "../shared/viewData";
import { isTestFile } from "./patterns";

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
  members: Member[];
  hasDocComment: boolean;
  /** imported name -> lines in this file that use it */
  usage: Record<string, CallSite[]>;
  /** property name -> first line in this file that reads it, as in `service.remove(` */
  firstPropertyAccessLine: Map<string, number>;
  /** names that appear in this file outside the place that declares them */
  referencedNames: Set<string>;
  rendersJsx: boolean;
  /** imported names used as JSX elements, as in `<Avatar />`, at the first line each appears */
  renderedComponents: { name: string; line: number }[];
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

  const firstPropertyAccessLine = new Map<string, number>();
  const referencedNames = new Set<string>();
  let rendersJsx = false;
  const renderedComponents: SourceAnalysis["renderedComponents"] = [];

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningFragment(node)) rendersJsx = true;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      rendersJsx = true;
      const name = ts.isIdentifier(node.tagName) ? node.tagName.text : "";
      if (importedNameSet.has(name) && !renderedComponents.some((component) => component.name === name)) renderedComponents.push({ name, line: lineOf(node) });
    }
    if (isDynamicImportOrRequire(node)) addImport((node.arguments[0] as ts.StringLiteral).text, node, [], false, true);
    if (ts.isIdentifier(node) && importedNameSet.has(node.text) && !isInsideImport(node)) recordUsage(node.text, node);
    if (ts.isMemberName(node) && !isDeclaredName(node)) referencedNames.add(node.text);
    if (ts.isPropertyAccessExpression(node) && !firstPropertyAccessLine.has(node.name.text)) firstPropertyAccessLine.set(node.name.text, lineOf(node.name));
    if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const typeName = fieldTypes.get(node.name.text);
      if (typeName) recordUsage(typeName, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const heritage = heritageNamesOf(source);
  const members = collectMembers(source, lineOf).map((member) => ({ ...member, ...heritage.get(`${member.kind} ${member.name}`) }));
  if (isTestFile(path)) members.push(...collectTestCases(source, lineOf));
  if (rendersJsx) members.push(...collectComponentProps(source, lineOf));
  members.sort((left, right) => left.line - right.line);
  return { path, lineCount: sourceLines.length, imports, exports, publicMethods, members, hasDocComment, usage, firstPropertyAccessLine, referencedNames, rendersJsx, renderedComponents };
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

function isPublic(member: ts.Node): boolean {
  return !hasModifier(member, ts.SyntaxKind.PrivateKeyword) && !hasModifier(member, ts.SyntaxKind.ProtectedKeyword);
}

function classMemberVisibility(name: ts.MemberName, declaration: ts.Node): MemberVisibility {
  if (ts.isPrivateIdentifier(name) || hasModifier(declaration, ts.SyntaxKind.PrivateKeyword)) return "private";
  return hasModifier(declaration, ts.SyntaxKind.ProtectedKeyword) ? "protected" : "public";
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
      if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && isPublic(member)) methods.push(member.name.text);
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

function collectMembers(source: ts.SourceFile, lineOf: (node: ts.Node) => number): Member[] {
  const members: Member[] = [];
  const endLineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  const add = (name: string, kind: MemberKind, nameNode: ts.Node, declaration: ts.Node, exported: boolean, visibility: MemberVisibility, className?: string) =>
    members.push({ name, kind, line: lineOf(nameNode), endLine: endLineOf(declaration), exported, visibility, ...(className ? { className } : {}) });
  const addTopLevel = (name: string, kind: MemberKind, nameNode: ts.Node, declaration: ts.Node, exported: boolean) =>
    add(name, kind, nameNode, declaration, exported, exported ? "exported" : "not exported");
  const exportedByName = localNamesExportedSeparately(source);

  for (const statement of source.statements) {
    const isExportedName = (name: string) => isExported(statement) || exportedByName.has(name);
    if (ts.isFunctionDeclaration(statement)) {
      const name = statement.name?.text ?? "default";
      addTopLevel(name, "function", statement.name ?? statement, statement, isExportedName(name));
    } else if (ts.isInterfaceDeclaration(statement)) addTopLevel(statement.name.text, "interface", statement.name, statement, isExportedName(statement.name.text));
    else if (ts.isTypeAliasDeclaration(statement)) addTopLevel(statement.name.text, "type", statement.name, statement, isExportedName(statement.name.text));
    else if (ts.isEnumDeclaration(statement)) addTopLevel(statement.name.text, "enum", statement.name, statement, isExportedName(statement.name.text));
    else if (ts.isVariableStatement(statement)) {
      const keyword = statement.declarationList.flags & ts.NodeFlags.Const ? "const" : "let";
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const holdsFunction = declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer));
        addTopLevel(declaration.name.text, holdsFunction ? "function" : keyword, declaration.name, declaration, isExportedName(declaration.name.text));
      }
    } else if (ts.isClassDeclaration(statement)) {
      const className = statement.name?.text ?? "default";
      const classExported = isExportedName(className);
      addTopLevel(className, "class", statement.name ?? statement, statement, classExported);
      const addClassMember = (name: ts.MemberName, kind: MemberKind, declaration: ts.Node) => {
        const visibility = classMemberVisibility(name, declaration);
        add(name.text, kind, name, declaration, classExported && visibility === "public", visibility, className);
      };
      for (const member of statement.members) {
        if (ts.isConstructorDeclaration(member)) {
          for (const parameter of member.parameters) {
            if (ts.isParameterPropertyDeclaration(parameter, member) && ts.isIdentifier(parameter.name)) addClassMember(parameter.name, "property", parameter);
          }
        } else if (ts.isMethodDeclaration(member) && ts.isMemberName(member.name)) addClassMember(member.name, "method", member);
        else if (ts.isPropertyDeclaration(member) && ts.isMemberName(member.name)) addClassMember(member.name, "property", member);
      }
    }
  }

  return members;
}

// props are read only from an inline type, a local interface or a local type alias
function collectComponentProps(source: ts.SourceFile, lineOf: (node: ts.Node) => number): Member[] {
  const props: Member[] = [];
  const readPropsTypes = new Set<readonly ts.TypeElement[]>();
  for (const statement of source.statements) {
    for (const component of componentFunctionsOf(statement)) {
      const propsType = component.parameters[0]?.type;
      const propsMembers = propsType && propsTypeMembersOf(source, propsType);
      if (!propsMembers || readPropsTypes.has(propsMembers)) continue;
      readPropsTypes.add(propsMembers);
      for (const member of propsMembers) {
        if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) continue;
        const endLine = source.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
        props.push({ name: member.name.text, kind: "prop", line: lineOf(member.name), endLine, exported: false, optional: !!member.questionToken });
      }
    }
  }
  return props;
}

const isComponentName = (name: string) => /^[A-Z]/.test(name);

function componentFunctionsOf(statement: ts.Statement): ts.SignatureDeclaration[] {
  if (ts.isFunctionDeclaration(statement)) return statement.name && isComponentName(statement.name.text) ? [statement] : [];
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.flatMap((declaration) => {
    const initializer = declaration.initializer;
    const holdsFunction = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
    return holdsFunction && ts.isIdentifier(declaration.name) && isComponentName(declaration.name.text) ? [initializer] : [];
  });
}

function propsTypeMembersOf(source: ts.SourceFile, type: ts.TypeNode): readonly ts.TypeElement[] | undefined {
  if (ts.isTypeLiteralNode(type)) return type.members;
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) return undefined;
  const typeName = type.typeName.text;
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === typeName) return statement.members;
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName && ts.isTypeLiteralNode(statement.type)) return statement.type.members;
  }
  return undefined;
}

function heritageNamesOf(source: ts.SourceFile): Map<string, Pick<Member, "implements" | "extends">> {
  const heritage = new Map<string, Pick<Member, "implements" | "extends">>();
  for (const statement of source.statements) {
    if (!(ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)) || !statement.heritageClauses) continue;
    const namesIn = (token: ts.SyntaxKind) =>
      statement.heritageClauses!.filter((clause) => clause.token === token).flatMap((clause) => clause.types.flatMap((type) => (ts.isIdentifier(type.expression) ? [type.expression.text] : [])));
    const implementsNames = namesIn(ts.SyntaxKind.ImplementsKeyword);
    const extendsNames = namesIn(ts.SyntaxKind.ExtendsKeyword);
    const kind = ts.isClassDeclaration(statement) ? "class" : "interface";
    heritage.set(`${kind} ${statement.name?.text ?? "default"}`, {
      ...(implementsNames.length ? { implements: implementsNames } : {}),
      ...(extendsNames.length ? { extends: extendsNames } : {}),
    });
  }
  return heritage;
}

const TEST_CALLS: Record<string, { kind: MemberKind; focus?: "only" | "skip" }> = {
  describe: { kind: "suite" },
  context: { kind: "suite" },
  suite: { kind: "suite" },
  "test.describe": { kind: "suite" },
  fdescribe: { kind: "suite", focus: "only" },
  xdescribe: { kind: "suite", focus: "skip" },
  it: { kind: "test" },
  test: { kind: "test" },
  fit: { kind: "test", focus: "only" },
  xit: { kind: "test", focus: "skip" },
};

function collectTestCases(source: ts.SourceFile, lineOf: (node: ts.Node) => number): Member[] {
  const testCases: Member[] = [];
  const visit = (node: ts.Node, suiteTitle: string | undefined) => {
    const testCase = ts.isCallExpression(node) ? testCaseOf(node) : undefined;
    if (testCase) {
      const endLine = source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      testCases.push({ name: testCase.title, kind: testCase.kind, line: lineOf(node), endLine, exported: false, ...(suiteTitle ? { suiteTitle } : {}), ...(testCase.focus ? { focus: testCase.focus } : {}) });
    }
    const innerSuiteTitle = testCase?.kind === "suite" ? testCase.title : suiteTitle;
    ts.forEachChild(node, (child) => visit(child, innerSuiteTitle));
  };
  visit(source, undefined);
  return testCases;
}

function testCaseOf(call: ts.CallExpression): { title: string; kind: MemberKind; focus?: "only" | "skip" } | undefined {
  const [firstArgument] = call.arguments;
  if (!firstArgument || !ts.isStringLiteralLike(firstArgument)) return undefined;
  const calleeParts = calleePartsOf(call.expression);
  const lastPart = calleeParts.at(-1);
  const modifier = lastPart === "only" || lastPart === "skip" ? lastPart : undefined;
  const calleeName = (modifier ? calleeParts.slice(0, -1) : calleeParts).join(".");
  if (!Object.hasOwn(TEST_CALLS, calleeName)) return undefined;
  const { kind, focus } = TEST_CALLS[calleeName];
  return { title: firstArgument.text, kind, focus: focus ?? modifier };
}

function calleePartsOf(callee: ts.Expression): string[] {
  if (ts.isIdentifier(callee)) return [callee.text];
  if (!ts.isPropertyAccessExpression(callee)) return [];
  const objectParts = calleePartsOf(callee.expression);
  return objectParts.length > 0 ? [...objectParts, callee.name.text] : [];
}

function localNamesExportedSeparately(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) names.add(statement.expression.text);
    else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) names.add((element.propertyName ?? element.name).text);
    }
  }
  return names;
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

function isDeclaredName(identifier: ts.MemberName): boolean {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent) || ts.isShorthandPropertyAssignment(parent) || ts.isExportSpecifier(parent)) return false;
  return (parent as ts.NamedDeclaration).name === identifier;
}

function isInsideImport(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isImportDeclaration(current) || ts.isImportEqualsDeclaration(current) || ts.isExportDeclaration(current)) return true;
  }
  return false;
}
