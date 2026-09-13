import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
export async function createSamplePdf() {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const ink = rgb(0.14, 0.2, 0.17),
    green = rgb(0.08, 0.39, 0.28),
    gray = rgb(0.42, 0.47, 0.44);
  const pages = [
    ["A little more clarity.", "A lot more possibility."],
    ["The right work,", "in the right order."],
    ["Good things start", "with a conversation."],
  ];
  pages.forEach((title, i) => {
    const p = doc.addPage([595.28, 841.89]);
    const text = (
      str: string,
      x: number,
      y: number,
      size = 11,
      font = regular,
      color = ink,
    ) => p.drawText(str, { x, y, size, font, color });
    text("NORTHLINE", 48, 784, 15, bold, green);
    text("DESIGN STUDIO", 48, 766, 8, regular, gray);
    text("PROJECT PROPOSAL", 404, 784, 8, bold, gray);
    p.drawLine({
      start: { x: 48, y: 740 },
      end: { x: 547, y: 740 },
      color: rgb(0.83, 0.87, 0.84),
      thickness: 1,
    });
    text(
      "0" +
        (i + 1) +
        "  /  " +
        ["THE OVERVIEW", "THE APPROACH", "NEXT STEPS"][i],
      48,
      705,
      9,
      bold,
      green,
    );
    text(title[0], 48, 650, 34, serif);
    text(title[1], 48, 607, 34, serif);
    if (i === 0) {
      text("Brand identity & website design", 48, 558, 13, regular, gray);
      p.drawRectangle({
        x: 48,
        y: 435,
        width: 499,
        height: 84,
        color: rgb(0.95, 0.965, 0.95),
      });
      text("PREPARED FOR", 65, 494, 8, bold, gray);
      text("Evergreen Collective", 65, 473, 12, bold);
      text("PREPARED BY", 318, 494, 8, bold, gray);
      text("Northline Design Studio", 318, 473, 12, bold);
      text("Hello, Alex.", 48, 391, 17, bold);
      [
        "Every great brand begins with a clear idea. We help turn that idea into",
        "an identity people remember, and a digital experience they love.",
        "This proposal outlines how we can bring your next chapter to life.",
      ].forEach((t, j) => text(t, 48, 363 - j * 19, 11));
      text("What we'll create together", 48, 272, 16, bold);
      const cols = [
        ["01", "Brand strategy", "A clear voice. A shared direction."],
        ["02", "Visual identity", "A look that feels distinctly you."],
        ["03", "Website design", "Thoughtful, from the first click."],
      ];
      cols.forEach((c, j) => {
        const x = 48 + j * 170;
        text(c[0], x, 236, 9, bold, green);
        text(c[1], x, 211, 12, bold);
        text(c[2], x, 190, 8, regular, gray);
      });
    } else {
      const sections =
        i === 1
          ? [
              [
                "01  Discover",
                "We listen, ask better questions, and find what makes you different.",
              ],
              [
                "02  Design",
                "We explore a focused visual direction and refine it together.",
              ],
              [
                "03  Deliver",
                "A complete toolkit, a thoughtful website, and a confident launch.",
              ],
            ]
          : [
              [
                "A shared starting point",
                "Review the scope, add your notes, and make this proposal your own.",
              ],
              [
                "Timeline",
                "Six weeks, with time built in for feedback at every stage.",
              ],
              ["Let's get started", "hello@northline.example"],
            ];
      sections.forEach(([h, b], j) => {
        text(h, 48, 535 - j * 112, 16, bold);
        text(b, 48, 505 - j * 112, 10);
        p.drawLine({
          start: { x: 48, y: 473 - j * 112 },
          end: { x: 547, y: 473 - j * 112 },
          color: rgb(0.87, 0.9, 0.88),
          thickness: 0.6,
        });
      });
    }
    p.drawLine({
      start: { x: 48, y: 105 },
      end: { x: 547, y: 105 },
      color: rgb(0.83, 0.87, 0.84),
      thickness: 1,
    });
    text("NORTHLINE  /  EVERGREEN COLLECTIVE", 48, 80, 8, regular, gray);
    text(String(i + 1).padStart(2, "0"), 531, 80, 9, bold, green);
  });
  return doc.save();
}
