/**
 * Pure unit tests for type plausibility — no DOM, no IPC, no React.
 *
 * Goal: lock in the rules so the cohort split (sync planning §3) and
 * future memo-extension work can extend `plausibleTypes` without
 * silently breaking existing types. Each branch of the decision tree
 * gets at least one test.
 */

import { describe, it, expect } from 'vitest';
import {
  plausibleTypes,
  isUrlLike,
  isPathLike,
  isExeLike,
  isTextDocLike,
} from './typePlausibility';

describe('isUrlLike', () => {
  it('accepts http and https', () => {
    expect(isUrlLike('https://github.com')).toBe(true);
    expect(isUrlLike('http://example.com')).toBe(true);
  });
  it('accepts bare domain', () => {
    expect(isUrlLike('github.com')).toBe(true);
    expect(isUrlLike('news.ycombinator.com/item?id=1')).toBe(true);
  });
  it('rejects paths (backslash, leading slash)', () => {
    expect(isUrlLike('C:\\foo')).toBe(false);
    expect(isUrlLike('/usr/bin')).toBe(false);
  });
  it('rejects strings with spaces', () => {
    expect(isUrlLike('hello world')).toBe(false);
  });
});

describe('isPathLike', () => {
  it('accepts windows drive paths', () => {
    expect(isPathLike('C:\\Users\\me')).toBe(true);
    expect(isPathLike('D:/projects')).toBe(true);
  });
  it('accepts UNC paths', () => {
    expect(isPathLike('\\\\server\\share')).toBe(true);
  });
  it('accepts POSIX paths', () => {
    expect(isPathLike('/etc/hosts')).toBe(true);
  });
  it('rejects bare strings', () => {
    expect(isPathLike('foo.exe')).toBe(false);
    expect(isPathLike('github.com')).toBe(false);
  });
});

describe('isExeLike', () => {
  it.each(['app.exe', 'tool.lnk', 'run.bat', 'helper.cmd', 'pkg.msi'])('matches %s', (s) => {
    expect(isExeLike(s)).toBe(true);
  });
  it('rejects non-exe extensions', () => {
    expect(isExeLike('readme.md')).toBe(false);
    expect(isExeLike('photo.png')).toBe(false);
  });
});

describe('isTextDocLike', () => {
  it.each(['note.txt', 'README.md', 'CHANGELOG.markdown'])('matches %s', (s) => {
    expect(isTextDocLike(s)).toBe(true);
  });
  it('rejects other extensions', () => {
    expect(isTextDocLike('photo.png')).toBe(false);
    expect(isTextDocLike('archive.zip')).toBe(false);
    expect(isTextDocLike('app.exe')).toBe(false);
  });
});

describe('plausibleTypes', () => {
  it('empty value → all types (no signal)', () => {
    const t = plausibleTypes('');
    expect(t.has('url')).toBe(true);
    expect(t.has('folder')).toBe(true);
    expect(t.has('memo')).toBe(true);
  });

  it('multiline → memo + text', () => {
    const t = plausibleTypes('line one\nline two');
    expect(t.has('memo')).toBe(true);
    expect(t.has('text')).toBe(true);
    expect(t.has('url')).toBe(false);
    expect(t.has('folder')).toBe(false);
  });

  it('hex color → text only (color swatch flow goes through different surface)', () => {
    const t = plausibleTypes('#1abc9c');
    expect(t.has('text')).toBe(true);
    expect(t.size).toBe(1);
  });

  it('https url → url + browser + text', () => {
    const t = plausibleTypes('https://github.com');
    expect(t.has('url')).toBe(true);
    expect(t.has('browser')).toBe(true);
    expect(t.has('text')).toBe(true);
    expect(t.has('folder')).toBe(false);
    expect(t.has('memo')).toBe(false);
  });

  it('bare domain → url + browser + text', () => {
    const t = plausibleTypes('news.ycombinator.com');
    expect(t.has('url')).toBe(true);
    expect(t.has('browser')).toBe(true);
    expect(t.has('text')).toBe(true);
  });

  it('exe path → app + text + cmd', () => {
    const t = plausibleTypes('C:\\Program Files\\App\\app.exe');
    expect(t.has('app')).toBe(true);
    expect(t.has('text')).toBe(true);
    expect(t.has('cmd')).toBe(true);
    expect(t.has('folder')).toBe(false);
  });

  it('text-doc path (.txt) → memo + doc + folder + app + text (sync §3.1 cohort B for path resolution)', () => {
    const t = plausibleTypes('C:\\Users\\me\\note.txt');
    expect(t.has('memo')).toBe(true);
    expect(t.has('doc')).toBe(true);
    expect(t.has('folder')).toBe(true);
    expect(t.has('app')).toBe(true);
    expect(t.has('text')).toBe(true);
  });

  it('document path (.pptx/.docx/.pdf/.hwp) → doc + folder + app + text', () => {
    for (const sample of [
      'D:\\proj\\report.pptx',
      'D:\\proj\\doc.docx',
      'C:\\Users\\me\\paper.pdf',
      'D:\\\\nas\\file.hwp',
    ]) {
      const t = plausibleTypes(sample);
      expect(t.has('doc'),    `${sample} should be doc-plausible`).toBe(true);
      expect(t.has('folder'), `${sample} should keep folder fallback`).toBe(true);
      expect(t.has('app'),    `${sample} should keep app fallback`).toBe(true);
      expect(t.has('text'),   `${sample} should keep text fallback`).toBe(true);
    }
  });

  it('custom docExtensions: a user-added extension classifies as doc', () => {
    // User adds `.epub` in Settings → drag-drop should also surface 'doc'.
    const userExts = ['epub', 'docx', 'pdf'];
    const t = plausibleTypes('C:\\books\\story.epub', userExts);
    expect(t.has('doc')).toBe(true);
    expect(t.has('folder')).toBe(true);
  });

  it('custom docExtensions: an extension NOT in the user list stays default-folder', () => {
    // User defined ONLY epub — .pptx should NOT match 'doc' under this
    // override and falls through to folder/app/text. (Matches the
    // semantics of getDocumentExtensions: a non-empty saved list
    // replaces defaults entirely.)
    const userExts = ['epub'];
    const t = plausibleTypes('D:\\proj\\report.pptx', userExts);
    expect(t.has('doc')).toBe(false);
    expect(t.has('folder')).toBe(true);
    expect(t.has('app')).toBe(true);
  });

  it('empty custom docExtensions: falls back to defaults (pptx still doc)', () => {
    const t = plausibleTypes('D:\\proj\\report.pptx', []);
    expect(t.has('doc')).toBe(true);
  });

  it('plain folder path → folder + app + text (no memo, no url)', () => {
    const t = plausibleTypes('C:\\Users\\me\\Downloads');
    expect(t.has('folder')).toBe(true);
    expect(t.has('app')).toBe(true);
    expect(t.has('text')).toBe(true);
    expect(t.has('memo')).toBe(false);
    expect(t.has('url')).toBe(false);
  });

  it('long blob → text only', () => {
    const longBlob = 'a '.repeat(60); // 120 chars, > 100 threshold
    const t = plausibleTypes(longBlob);
    expect(t.has('text')).toBe(true);
    expect(t.size).toBe(1);
  });

  it('short ambiguous string → window + text + cmd', () => {
    const t = plausibleTypes('Visual Studio Code');
    expect(t.has('window')).toBe(true);
    expect(t.has('text')).toBe(true);
    expect(t.has('cmd')).toBe(true);
    expect(t.has('url')).toBe(false);
    expect(t.has('folder')).toBe(false);
  });

  it('bare exe (no path) → app + cmd + text', () => {
    const t = plausibleTypes('notepad.exe');
    expect(t.has('app')).toBe(true);
    expect(t.has('cmd')).toBe(true);
    expect(t.has('text')).toBe(true);
  });
});
