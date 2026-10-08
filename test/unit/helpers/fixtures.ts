import type { SourceAnalysis } from "../../../src/graph/analyzeSource";
import { createGraph, setFile, type Graph, type RelResolver } from "../../../src/graph/buildGraph";

function nameFrom(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\..*$/, "");
}

export function analysisOf(path: string, imports: string[] = [], extra: Partial<SourceAnalysis> = {}): SourceAnalysis {
  return {
    path,
    lineCount: 20,
    imports: imports.map((raw, index) => {
      const typeOnly = raw.startsWith("type:");
      const specifier = raw.replace(/^type:/, "");
      const name = nameFrom(specifier);
      return { specifier, line: index + 1, text: `import { ${name} } from "${specifier}"`, names: [name], typeOnly, dynamic: false };
    }),
    exports: [],
    publicMethods: [],
    members: [],
    hasDocComment: false,
    usage: {},
    firstPropertyAccessLine: new Map(),
    referencedNames: new Set(),
    rendersJsx: false,
    renderedComponents: [],
    ...extra,
  };
}

export const directResolver: RelResolver = (specifier) =>
  specifier.startsWith("pkg:") ? { kind: "package", name: specifier.slice(4) } : { kind: "file", path: specifier };

export function graphOf(files: SourceAnalysis[]): Graph {
  const graph = createGraph();
  for (const file of files) setFile(graph, file, directResolver);
  return graph;
}

export const DOCUMENT_SERVICE = "src/services/DocumentService.ts";

/** the "Typical service" sample from the design canvas */
export function serviceGraph(): Graph {
  return graphOf([
    analysisOf(DOCUMENT_SERVICE, ["src/db/repositories/DocumentRepository.ts", "src/integrations/storage/StorageClient.ts", "src/auth/PermissionPolicy.ts", "type:src/types/document.types.ts"], {
      lineCount: 31,
      exports: ["class DocumentService"],
      publicMethods: ["listForEmployee", "upload", "remindUnsigned"],
      usage: { DocumentRepository: [{ line: 15, text: "return this.documents.findByEmployee(employeeId)" }] },
    }),
    ...["Employee", "Contract", "Leave", "Payroll"].flatMap((name) => [
      analysisOf(`src/services/${name}Service.ts`, [`src/services/I${name}Service.ts`], { lineCount: 120 }),
      analysisOf(`src/services/I${name}Service.ts`),
      analysisOf(`test/services/${name}Service.spec.ts`, [`src/services/${name}Service.ts`]),
    ]),
    analysisOf("src/api/controllers/DocumentController.ts", [DOCUMENT_SERVICE], {
      usage: { DocumentService: [{ line: 27, text: "return this.service.listForEmployee(actor, id)" }] },
    }),
    analysisOf("src/jobs/SendReminderJob.ts", [DOCUMENT_SERVICE]),
    analysisOf("src/api/routes.ts", ["src/api/controllers/DocumentController.ts"]),
    analysisOf("src/jobs/scheduler.ts", ["src/jobs/SendReminderJob.ts"]),
    analysisOf("src/db/repositories/DocumentRepository.ts", ["src/db/schema.ts"]),
    analysisOf("src/db/schema.ts"),
    analysisOf("src/integrations/storage/StorageClient.ts", ["src/config/storage.config.ts"]),
    analysisOf("src/config/storage.config.ts"),
    analysisOf("src/auth/PermissionPolicy.ts", ["src/auth/roles.ts"]),
    analysisOf("src/auth/roles.ts"),
    analysisOf("src/types/document.types.ts"),
    analysisOf("test/services/DocumentService.spec.ts", [DOCUMENT_SERVICE, "test/fixtures/documents.fixture.ts"]),
    analysisOf("test/fixtures/documents.fixture.ts"),
  ]);
}
