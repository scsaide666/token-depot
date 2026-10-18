import { LegalPage } from "@/components/legal/legal-page";
import { legalDocuments } from "@/lib/legal-content";
import { publicMetadata } from "@/lib/seo";
const document = legalDocuments["/acceptable-use"];
export const metadata = publicMetadata(document.path, `${document.title} · Token Depot`, document.description);
export default function Page() { return <LegalPage path={document.path} />; }
