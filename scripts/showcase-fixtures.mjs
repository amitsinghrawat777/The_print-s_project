// Realistic-looking documents for the website screenshots (scripts/marketing-shots.mjs).
// Everything is generated, so there are no real people's files in the repo.
import { crc32, deflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const A4 = [595, 842];
const MARGIN = 64;
const INK = rgb(0.1, 0.1, 0.12);
const GREY = rgb(0.38, 0.38, 0.42);
const BLUE = rgb(0.15, 0.39, 0.92);
const ORANGE = rgb(0.96, 0.55, 0.12);

/** A tiny layout engine: headings, wrapped paragraphs, bullets, new pages as needed. */
async function writer() {
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  const width = A4[0] - MARGIN * 2;
  let page;
  let y;
  const newPage = () => {
    page = doc.addPage(A4);
    y = A4[1] - MARGIN;
    return page;
  };
  const lines = (text, font, size, max = width) => {
    const out = [];
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > max && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
    return out;
  };
  const w = {
    doc,
    fonts,
    width,
    get page() {
      return page;
    },
    get y() {
      return y;
    },
    set y(v) {
      y = v;
    },
    newPage,
    title(text, sub) {
      page.drawText(text, { x: MARGIN, y: y - 22, size: 22, font: fonts.bold, color: INK });
      y -= 40;
      if (sub) {
        page.drawText(sub, { x: MARGIN, y, size: 10.5, font: fonts.regular, color: GREY });
        y -= 16;
      }
      page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + width, y }, thickness: 0.8, color: rgb(0.8, 0.8, 0.82) });
      y -= 26;
    },
    heading(text) {
      if (y < 140) newPage();
      page.drawText(text, { x: MARGIN, y, size: 13.5, font: fonts.bold, color: INK });
      y -= 22;
    },
    para(text, { size = 10.5, font = fonts.regular, indent = 0, color = INK } = {}) {
      for (const l of lines(text, font, size, width - indent)) {
        if (y < MARGIN + 20) newPage();
        page.drawText(l, { x: MARGIN + indent, y, size, font, color });
        y -= size * 1.55;
      }
      y -= 8;
    },
    bullets(items) {
      for (const item of items) {
        page.drawCircle({ x: MARGIN + 6, y: y + 3.5, size: 1.8, color: INK });
        this.para(item, { indent: 18 });
        y += 4;
      }
      y -= 6;
    },
    code(textLines) {
      const h = textLines.length * 14 + 16;
      page.drawRectangle({ x: MARGIN, y: y - h + 10, width, height: h, color: rgb(0.95, 0.95, 0.96) });
      y -= 6;
      for (const l of textLines) {
        page.drawText(l, { x: MARGIN + 12, y, size: 9.5, font: fonts.mono, color: INK });
        y -= 14;
      }
      y -= 18;
    },
    footer(text) {
      doc.getPages().forEach((p, i, all) =>
        p.drawText(`${text} · Page ${i + 1} of ${all.length}`, { x: MARGIN, y: 34, size: 8.5, font: fonts.regular, color: GREY }),
      );
    },
  };
  newPage();
  return w;
}

/** 4 pages; page 3 is a colour graph, the rest is black text. */
export async function labReport() {
  const w = await writer();
  w.title('Simple Pendulum: Measuring g', 'Physics Lab Report  ·  Priya Sharma  ·  B.Sc. Year 2, Section B  ·  Experiment 4');
  w.heading('1. Aim');
  w.para('To find the acceleration due to gravity (g) by measuring how the period of a simple pendulum changes with its length, and to check that the square of the period is proportional to the length.');
  w.heading('2. Apparatus');
  w.bullets([
    'A heavy brass bob with a hook, and a thin cotton thread about 1.2 m long',
    'A split cork and a clamp stand fixed to the edge of the table',
    'A stopwatch reading to 0.01 s, and a metre scale with a vernier caliper',
  ]);
  w.heading('3. Theory');
  w.para('For small swings the period of a simple pendulum depends only on its effective length L and on g: T = 2 pi sqrt(L / g). Squaring both sides gives T^2 = (4 pi^2 / g) L, so a graph of T^2 against L is a straight line through the origin whose slope is 4 pi^2 / g.');
  w.para('The effective length is measured from the point of suspension to the centre of the bob, so the radius of the bob (measured with the vernier caliper) is added to the length of the thread.');
  w.heading('4. Method');
  w.para('The thread was clamped in the split cork and the length was set to 50 cm. The bob was pulled aside by about 5 degrees and released, and the time for 20 complete swings was measured twice. The length was then increased in steps of 10 cm up to 90 cm.');

  w.newPage();
  w.heading('5. Observations');
  w.para('Radius of the bob r = 1.05 cm. Least count of the stopwatch = 0.01 s.', { color: GREY });
  const cols = ['L (m)', 'Time for 20 swings (s)', 'Mean (s)', 'T (s)', 'T^2 (s^2)'];
  const rows = [
    ['0.51', '28.62  /  28.70', '28.66', '1.433', '2.054'],
    ['0.61', '31.35  /  31.29', '31.32', '1.566', '2.452'],
    ['0.71', '33.80  /  33.86', '33.83', '1.692', '2.861'],
    ['0.81', '36.10  /  36.06', '36.08', '1.804', '3.254'],
    ['0.91', '38.27  /  38.31', '38.29', '1.915', '3.665'],
  ];
  const xs = [0, 62, 222, 302, 382];
  const top = w.y;
  [cols, ...rows].forEach((r, i) => {
    const rowY = top - i * 26;
    if (i === 0) w.page.drawRectangle({ x: 64, y: rowY - 8, width: w.width, height: 24, color: rgb(0.94, 0.94, 0.95) });
    r.forEach((cell, j) =>
      w.page.drawText(cell, { x: 72 + xs[j], y: rowY, size: 10, font: i === 0 ? w.fonts.bold : w.fonts.regular, color: INK }),
    );
    w.page.drawLine({ start: { x: 64, y: rowY - 8 }, end: { x: 64 + w.width, y: rowY - 8 }, thickness: 0.5, color: rgb(0.82, 0.82, 0.85) });
  });
  w.y = top - rows.length * 26 - 40;
  w.heading('Calculation');
  w.para('Slope of the T^2 against L graph (from page 3) = (3.665 - 2.054) / (0.91 - 0.51) = 4.03 s^2/m.');
  w.para('g = 4 pi^2 / slope = 39.48 / 4.03 = 9.80 m/s^2.');

  w.newPage();
  w.heading('6. Graph of T^2 against L');
  // a colour chart: axes, points, best-fit line
  const g = { x: 100, y: 330, w: 400, h: 330 };
  const p = w.page;
  p.drawRectangle({ x: g.x, y: g.y, width: g.w, height: g.h, color: rgb(0.97, 0.98, 1) });
  for (let i = 0; i <= 5; i++) {
    const gy = g.y + (g.h * i) / 5;
    p.drawLine({ start: { x: g.x, y: gy }, end: { x: g.x + g.w, y: gy }, thickness: 0.4, color: rgb(0.85, 0.88, 0.95) });
    p.drawText((i * 0.8).toFixed(1), { x: g.x - 26, y: gy - 3, size: 9, font: w.fonts.regular, color: GREY });
    const gx = g.x + (g.w * i) / 5;
    p.drawLine({ start: { x: gx, y: g.y }, end: { x: gx, y: g.y + g.h }, thickness: 0.4, color: rgb(0.85, 0.88, 0.95) });
    p.drawText((i * 0.2).toFixed(1), { x: gx - 6, y: g.y - 16, size: 9, font: w.fonts.regular, color: GREY });
  }
  const px = (l) => g.x + (l / 1.0) * g.w;
  const py = (t2) => g.y + (t2 / 4.0) * g.h;
  p.drawLine({ start: { x: px(0), y: py(0) }, end: { x: px(0.98), y: py(0.98 * 4.03) }, thickness: 2, color: ORANGE });
  for (const [l, t2] of [[0.51, 2.054], [0.61, 2.452], [0.71, 2.861], [0.81, 3.254], [0.91, 3.665]]) {
    p.drawCircle({ x: px(l), y: py(t2), size: 5, color: BLUE });
  }
  p.drawText('L (m)', { x: g.x + g.w / 2 - 12, y: g.y - 36, size: 10, font: w.fonts.bold, color: INK });
  p.drawText('T^2 (s^2)', { x: g.x - 30, y: g.y + g.h + 14, size: 10, font: w.fonts.bold, color: INK });
  p.drawCircle({ x: g.x + 14, y: g.y + g.h - 18, size: 5, color: BLUE });
  p.drawText('Measured', { x: g.x + 26, y: g.y + g.h - 21, size: 9.5, font: w.fonts.regular, color: INK });
  p.drawLine({ start: { x: g.x + 90, y: g.y + g.h - 18 }, end: { x: g.x + 110, y: g.y + g.h - 18 }, thickness: 2, color: ORANGE });
  p.drawText('Best fit, slope 4.03 s^2/m', { x: g.x + 116, y: g.y + g.h - 21, size: 9.5, font: w.fonts.regular, color: INK });
  w.y = g.y - 70;
  w.para('The points lie close to a straight line through the origin, as the theory predicts.', { color: GREY });

  w.newPage();
  w.heading('7. Result');
  w.para('The acceleration due to gravity in the laboratory is g = 9.80 m/s^2, within 0.1% of the accepted value of 9.81 m/s^2. The graph of T^2 against L is a straight line through the origin, so T^2 is proportional to L.');
  w.heading('8. Precautions');
  w.bullets([
    'The amplitude was kept small (under 10 degrees) so that the formula holds.',
    'Timing started at the middle of a swing, where the bob moves fastest and the moment is easiest to judge.',
    'The pendulum swung in a single plane, without spinning.',
  ]);
  w.heading('9. Sources of error');
  w.para('Reaction time when starting and stopping the stopwatch is the largest source of error; timing 20 swings instead of one reduces it twenty times. Air resistance and the mass of the thread were neglected.');
  w.footer('Simple Pendulum · Priya Sharma');
  return Buffer.from(await w.doc.save());
}

/** 1 page. */
export async function resume() {
  const w = await writer();
  w.title('Rahul Verma', 'rahul.verma@example.com  ·  +91 98XXX XXX10  ·  Dehradun, Uttarakhand');
  w.heading('Objective');
  w.para('Commerce graduate looking for a junior accountant role where I can use my Tally and GST filing experience and keep learning.');
  w.heading('Education');
  w.para('B.Com (Hons), DAV PG College, Dehradun · 2023 to 2026 · 78%');
  w.para('Class XII (Commerce), Kendriya Vidyalaya, Dehradun · 2023 · 88%');
  w.heading('Experience');
  w.para('Accounts intern, Joshi & Associates (Chartered Accountants) · June to August 2025', { font: w.fonts.bold });
  w.bullets([
    'Prepared monthly GST returns (GSTR-1 and GSTR-3B) for twelve small business clients.',
    'Reconciled bank statements in Tally Prime and flagged mismatches for review.',
    'Kept the client document register up to date for the audit season.',
  ]);
  w.heading('Skills');
  w.bullets(['Tally Prime, GST filing, TDS basics', 'Excel: pivot tables, VLOOKUP, charts', 'English and Hindi']);
  w.heading('Achievements');
  w.para('Second place in the inter-college commerce quiz, 2025. NSS volunteer for two years.');
  return Buffer.from(await w.doc.save());
}

/** 3 pages of text and code. */
export async function assignment() {
  const w = await writer();
  w.title('Assignment 3: Linked Lists', 'Data Structures (BCA-203)  ·  Neha Rawat  ·  Roll no. 21  ·  Submitted to Dr. A. Mehta');
  w.heading('Q1. What is a singly linked list?');
  w.para('A singly linked list is a chain of nodes where each node stores a value and a pointer to the next node. The list is reached through a pointer to its first node, the head, and the last node points to NULL. Unlike an array, the nodes do not have to sit next to each other in memory, so the list can grow and shrink one node at a time.');
  w.code(['struct Node {', '    int data;', '    struct Node *next;', '};']);
  w.heading('Q2. Insert a node at the beginning');
  w.para('A new node is created, its next pointer is set to the current head, and the head is moved to the new node. This takes constant time, O(1), whatever the length of the list.');
  w.code([
    'void push(struct Node **head, int value) {',
    '    struct Node *node = malloc(sizeof *node);',
    '    node->data = value;',
    '    node->next = *head;',
    '    *head = node;',
    '}',
  ]);
  w.heading('Q3. Reverse a linked list');
  w.para('Walk the list once, turning each next pointer around. Three pointers are enough: the previous node, the current node and the next node. The loop ends when current reaches NULL, and previous is then the new head.');
  w.code([
    'struct Node *reverse(struct Node *head) {',
    '    struct Node *prev = NULL, *next;',
    '    while (head) {',
    '        next = head->next;',
    '        head->next = prev;',
    '        prev = head;',
    '        head = next;',
    '    }',
    '    return prev;',
    '}',
  ]);
  w.heading('Q4. Arrays and linked lists compared');
  w.bullets([
    'Access: an array reaches any element in O(1); a list has to walk from the head, O(n).',
    'Insertion at the front: O(n) for an array (everything shifts), O(1) for a list.',
    'Memory: a list needs an extra pointer per node but never has to be resized.',
  ]);
  w.heading('Q5. Detect a loop');
  w.para("Floyd's method moves a slow pointer one node at a time and a fast pointer two nodes at a time. If the list has a loop, the fast pointer eventually meets the slow one; if it reaches NULL, there is no loop. It uses O(1) extra memory.");
  w.footer('Assignment 3 · Neha Rawat');
  return Buffer.from(await w.doc.save());
}

/** A colourful landscape photo (PNG, RGB). */
export function photo(width = 900, height = 600) {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  const sun = { x: width * 0.72, y: height * 0.3, r: height * 0.11 };
  const hill = (x, base, amp, freq, phase) => base + amp * Math.sin((x / width) * Math.PI * freq + phase);
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < width; x++) {
      const t = y / height;
      // evening sky: deep blue to warm orange near the horizon
      let r = 40 + 215 * t ** 1.4;
      let g = 90 + 110 * t;
      let b = 200 - 90 * t;
      const d = Math.hypot(x - sun.x, y - sun.y);
      if (d < sun.r) [r, g, b] = [255, 214, 92];
      else if (d < sun.r * 2.2) {
        const glow = 1 - (d - sun.r) / (sun.r * 1.2);
        r += (255 - r) * glow * 0.5;
        g += (200 - g) * glow * 0.4;
      }
      const far = hill(x, height * 0.62, height * 0.05, 3, 0.4);
      const near = hill(x, height * 0.75, height * 0.07, 2, 2.1);
      if (y > near) [r, g, b] = [34 + 20 * (y / height), 120 - 30 * (y / height), 60];
      else if (y > far) [r, g, b] = [70, 140, 96];
      const i = y * row + 1 + x * 3;
      raw[i] = Math.max(0, Math.min(255, r));
      raw[i + 1] = Math.max(0, Math.min(255, g));
      raw[i + 2] = Math.max(0, Math.min(255, b));
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
