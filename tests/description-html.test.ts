import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { descriptionToText, isDescriptionEmpty, plainTextToDescription, sanitizeDescription } from "@/lib/descriptions/html";

describe("HTML descriptions", () => {
  it("keeps only supported formatting and safe attributes without active content", () => {
    expect(sanitizeDescription('<p onclick="evil()" class="word"><b>B</b><i>I</i><u style="color:red">U</u><br><a href="javascript:evil()">link</a><img src=x onerror=evil()></p><script>evil()</script><iframe>bad</iframe>')).toBe('<p><strong>B</strong><em>I</em><u>U</u><br /><a>link</a></p>');
    const html = '<ul><li><p>One</p></li></ul><ol><li><p>Two</p></li></ol>';
    expect(sanitizeDescription(html)).toBe(html);
    expect(sanitizeDescription(sanitizeDescription(html))).toBe(html);
  });
  it.each(["https://example.com/?a=1&amp;b=2", "http://example.com", "mailto:yoga@example.com", "tel:+4930123456"])("preserves a safe link when saving again: %s", (href) => {
    const html = `<p><a href="${href}" title="Kontakt"><strong>Mehr erfahren</strong></a></p>`;
    expect(sanitizeDescription(html)).toBe(html);
    expect(sanitizeDescription(sanitizeDescription(html))).toBe(html);
  });
  it.each(["javascript:alert(1)", "jav&#x61;script:alert(1)", "data:text/html,evil", "//example.com"])("removes unsafe link destinations and attributes: %s", (href) => {
    expect(sanitizeDescription(`<p><a href="${href}" onclick="evil()" target="_blank" style="color:red">Text</a></p>`)).toBe('<p><a>Text</a></p>');
  });
  it.each([null, "", "  ", "<p></p>", "<p><br></p>", "<p>&nbsp; &#160; &#xA0;</p>"])("recognizes empty content: %s", (html) => {
    expect(isDescriptionEmpty(html)).toBe(true);
    expect(sanitizeDescription(html)).toBeNull();
  });
  it("converts HTML to readable plaintext without double escaping", () => {
    expect(descriptionToText('<p>A &amp; B<br>C</p><p>D</p>')).toBe("A & B\nC\n\nD");
    expect(isDescriptionEmpty('<p>&lt;p&gt;</p>')).toBe(false);
  });
  it("executes the actual migration in isolated PostgreSQL and changes only descriptions", async () => {
    const db = new PGlite();
    try {
      const values = [null, "", '<p>A & "B"</p>\r\nC\r\n \r\nD', "x'y\rz", "\n\n\n", "  "];
      for (const table of ["Event", "EventSeries"]) {
        await db.exec(`CREATE TABLE "${table}" (id int, description text, shortdescription text, "updatedAt" text);`);
        for (const [id, value] of values.entries()) await db.query(`INSERT INTO "${table}" VALUES ($1, $2, 'unchanged', 'original')`, [id, value]);
      }
      await db.exec(readFileSync("prisma/migrations/20261104120000_description_html/migration.sql", "utf8"));
      for (const table of ["Event", "EventSeries"]) {
        const { rows } = await db.query<{ description: string | null; shortdescription: string; updatedAt: string }>(`SELECT * FROM "${table}" ORDER BY id`);
        expect(rows.map((row) => row.description)).toEqual(values.map(plainTextToDescription));
        expect(rows.every((row) => row.shortdescription === "unchanged" && row.updatedAt === "original")).toBe(true);
      }
      expect(plainTextToDescription('<p>')).toBe('<p>&lt;p&gt;</p>');
      expect(plainTextToDescription('A\nB\n\nC')).toBe('<p>A<br>B</p><p>C</p>');
    } finally { await db.close(); }
  }, 30000);
});
