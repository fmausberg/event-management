export function DescriptionHtml({ html }: { html: string | null | undefined }) {
  return <div className="description-html" dangerouslySetInnerHTML={{ __html: html ?? "" }} />;
}
