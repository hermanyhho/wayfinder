import { DocumentService } from "../services/DocumentService";
import { DocumentRow } from "./DocumentRow";

interface DocumentListProps {
  service: DocumentService;
  actorId: string;
  employeeId: string;
}

export async function DocumentList({ service, actorId, employeeId }: DocumentListProps) {
  const [latest, ...older] = await service.listForEmployee(actorId, employeeId);
  if (!latest) return <p>No documents yet.</p>;
  return (
    <ul>
      <DocumentRow document={latest} highlighted />
      {older.map((document) => (
        <DocumentRow key={document.id} document={document} />
      ))}
    </ul>
  );
}
