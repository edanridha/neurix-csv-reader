// A fast drop-in replacement for csv-reader 1.0.0: run(input) returns exactly
// csv-reader's reading of {text, header} — {columns, rows, errors} — on every
// input, following the same broken-row policy:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no
//     record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled ("" inside it is one quote, and each CRLF or lone CR inside it
//     is read as LF); what follows its closing quote, up to the next comma or
//     line break, is appended as it stands (quote_junk, when the field ends);
//   - a quote that never closes is a literal character, and the text after it
//     is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with "" (short_row, with fields: its field count) or cut (long_row,
//     with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met: line the 1-based line
//     its record starts on (counting every LF, CRLF and lone CR inside
//     quotes), row its record's index in rows, null for the header.
//
// Where the reference builds every field a character at a time, this reader
// scans by char code and slices each run of ordinary characters out of the
// text in one piece, so the common field costs one scan and one slice.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next (all state below is per-call, held in the closure).

// How a field ended.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended, and how many characters the last
  // readUnquoted call kept (the reference returns these in an object; here
  // they ride in two closure slots, so the hot path allocates nothing).
  let ended = END;
  let added = 0;

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr).
  function readUnquoted(value) {
    let out = value;
    let kept = 0;
    let seg = pos;
    let i = pos;
    while (i < len) {
      const c = text.charCodeAt(i);
      if (c === 44) { // ','
        if (i > seg) {
          out += text.slice(seg, i);
          kept += i - seg;
        }
        pos = i + 1;
        ended = COMMA;
        added = kept;
        return out;
      }
      if (c === 10) { // LF
        if (i > seg) {
          out += text.slice(seg, i);
          kept += i - seg;
        }
        pos = i + 1;
        line += 1;
        ended = LINE_BREAK;
        added = kept;
        return out;
      }
      if (c === 13) { // CR
        if (i + 1 < len && text.charCodeAt(i + 1) === 10) { // CRLF
          if (i > seg) {
            out += text.slice(seg, i);
            kept += i - seg;
          }
          pos = i + 2;
          line += 1;
          ended = LINE_BREAK;
          added = kept;
          return out;
        }
        if (i > seg) {
          out += text.slice(seg, i);
          kept += i - seg;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        i += 1;
        seg = i;
        continue;
      }
      i += 1;
    }
    if (len > seg) {
      out += text.slice(seg, len);
      kept += len - seg;
    }
    pos = len;
    ended = END;
    added = kept;
    return out;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let out = '';
    let seg = pos + 1;
    let i = seg;
    let closed = false;
    while (i < len) {
      const c = text.charCodeAt(i);
      if (c === 34) { // '"'
        if (text.charCodeAt(i + 1) === 34) { // doubled quote: one quote
          out += text.slice(seg, i) + '"';
          i += 2;
          seg = i;
          continue;
        }
        out += text.slice(seg, i);
        i += 1;
        closed = true;
        break;
      }
      if (c === 13) { // CR or CRLF inside quotes: one LF
        out += text.slice(seg, i) + '\n';
        line += 1;
        i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
        seg = i;
        continue;
      }
      if (c === 10) line += 1;
      i += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    pos = i;
    if (pos >= len) {
      ended = END;
      return out;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) { // ','
      pos += 1;
      ended = COMMA;
      return out;
    }
    if (c === 10) { // LF
      pos += 1;
      line += 1;
      ended = LINE_BREAK;
      return out;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) { // CRLF
      pos += 2;
      line += 1;
      ended = LINE_BREAK;
      return out;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const value = readUnquoted(out);
    if (added > 0) {
      errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    }
    return value;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = pos < len && text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      const extra = fields.splice(width);
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
