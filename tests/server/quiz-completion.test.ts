import { checkRecipeCompletion, CANONICAL_ORG } from '../../server/src/services/quiz/completion';

// Mock GitHub by stubbing global fetch. The service hits:
//   GET /repos/league-curriculum/<repo>/contents/<lessonPath>   (canonical dir)
//   GET /repos/<user>/<repo>/contents/<lessonPath>              (student dir)
// Each returns an array of {name, type, sha}.

type Entry = { name: string; path: string; type: 'file' | 'dir'; sha: string };
const realFetch = global.fetch;

function dir(files: Array<[string, string]>): Entry[] {
  return files.map(([name, sha]) => ({ name, path: name, type: 'file', sha }));
}

function mockGitHub(routes: Record<string, { status: number; body?: unknown }>) {
  global.fetch = jest.fn(async (url: string) => {
    // match by the "/repos/owner/repo/contents/..." suffix
    const key = Object.keys(routes).find((k) => (url as string).includes(k));
    const r = key ? routes[key] : { status: 404, body: { message: 'Not Found' } };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    } as Response;
  }) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

const CANON = `${CANONICAL_ORG}/Python-Apprentice/contents/lessons/30_Loops`;
const STUDENT = `alice/Python-Apprentice/contents/lessons/30_Loops`;

describe('checkRecipeCompletion', () => {
  it('complete when every required file exists and differs from the starter', async () => {
    mockGitHub({
      [CANON]: { status: 200, body: dir([['a.py', 'starterA'], ['b.py', 'starterB']]) },
      [STUDENT]: { status: 200, body: dir([['a.py', 'editedA'], ['b.py', 'editedB']]) },
    });
    const res = await checkRecipeCompletion({ githubUsername: 'alice', levelRepo: 'Python-Apprentice', lessonPath: 'lessons/30_Loops' });
    expect(res).toEqual({ complete: true, incomplete: [], checked: true });
  });

  it('reports a missing file and an unchanged (identical-to-starter) file as incomplete', async () => {
    mockGitHub({
      [CANON]: { status: 200, body: dir([['a.py', 'starterA'], ['b.py', 'starterB'], ['c.py', 'starterC']]) },
      // a.py edited; b.py identical to starter (untouched); c.py missing
      [STUDENT]: { status: 200, body: dir([['a.py', 'editedA'], ['b.py', 'starterB']]) },
    });
    const res = await checkRecipeCompletion({ githubUsername: 'alice', levelRepo: 'Python-Apprentice', lessonPath: 'lessons/30_Loops' });
    expect(res.complete).toBe(false);
    expect(res.checked).toBe(true);
    expect(res.incomplete.sort()).toEqual(['b.py', 'c.py']);
  });

  it('returns checked:false when the student fork is missing (404)', async () => {
    mockGitHub({
      [CANON]: { status: 200, body: dir([['a.py', 'starterA']]) },
      [STUDENT]: { status: 404 },
    });
    const res = await checkRecipeCompletion({ githubUsername: 'alice', levelRepo: 'Python-Apprentice', lessonPath: 'lessons/30_Loops' });
    expect(res.checked).toBe(false);
    expect(res.complete).toBe(false);
    expect(res.incomplete).toContain('a.py');
  });

  it('does not block when the canonical directory has no recipe files', async () => {
    mockGitHub({
      [CANON]: { status: 200, body: dir([['README.md', 'x'], ['images', 'y']]).map((e) => ({ ...e, name: e.name })) },
    });
    const res = await checkRecipeCompletion({ githubUsername: 'alice', levelRepo: 'Python-Apprentice', lessonPath: 'lessons/30_Loops' });
    expect(res).toEqual({ complete: true, incomplete: [], checked: true });
  });

  it('checked:false when the student has no github username or the level has no repo', async () => {
    const a = await checkRecipeCompletion({ githubUsername: null, levelRepo: 'Python-Apprentice', lessonPath: 'p' });
    expect(a.checked).toBe(false);
    const b = await checkRecipeCompletion({ githubUsername: 'alice', levelRepo: null, lessonPath: 'p' });
    expect(b.checked).toBe(false);
  });
});
