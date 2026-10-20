import { describe, expect, it } from 'vitest';
import { colInsertRewrite, mapAddressLiterals } from '../src/sheet/address';

const rewrite = (code: string, fromCol: number): string => mapAddressLiterals(code, (ends, _lit, tab) => (tab ? null : colInsertRewrite(fromCol, 1)(ends))).code;

describe('column insert rewrite', () => {
  it('moves single addresses at or right of the insertion point', () => {
    expect(rewrite("at('A1'); at('B7'); at('C2')", 1)).toBe("at('A1'); at('C7'); at('D2')");
  });
  it('stretches ranges that span the insertion point', () => {
    expect(rewrite("range('A1:C3')", 1)).toBe("range('A1:D3')");
    expect(rewrite("range('C1:D3')", 1)).toBe("range('D1:E3')");
    expect(rewrite("range('A1:A3')", 1)).toBe("range('A1:A3')");
  });
  it('keeps a column-with-row-range literal together', () => {
    expect(rewrite("range('C32-55')", 1)).toBe("range('D32-55')");
  });
  it('carries the address past Z into two letters and keeps case and dollars', () => {
    expect(rewrite("at('Z5'); at('$b$3')", 0)).toBe("at('AA5'); at('$c$3')");
  });
  it('leaves other tabs alone and ignores comments', () => {
    expect(rewrite("at('/lab/B2') // B2", 0)).toBe("at('/lab/B2') // B2");
  });
});
