export function DocumentRow({ document, highlighted = false }) {
  return <li className={highlighted ? "document-row latest" : "document-row"}>{document.fileKey}</li>;
}
