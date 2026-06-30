import { checkRecipeCompletion, CANONICAL_ORG } from '../../server/src/services/quiz/completion';

// Mock GitHub by stubbing global fetch. The new flow hits:
//   GET /repos/league-curriculum/<repo>/contents/<lessonPath>      (canonical dir)
//   GET /users/<user>/events?...                                    (discover repos)
//   GET /repos/<discovered>/contents/<lessonPath|short>            (student dir)
// Each contents call returns an array of {name, type, sha}; events returns
// PushEvent entries naming the student's repos.

type Entry = { name: string; path: string; type: 'file' | 'dir'; sha: string };
const realFetch = global.fetch;

function dir(files: Array<[string, string]>): Entry[] {
  return files.map(([name, sha]) => ({ name, path: name, type: 'file', sha }));
}

interface Route { status: number; body?: unknown }

function mockGitHub(routes: Record<string, Route>) {
  global.fetch = jest.fn(async (url: string) => {
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
const REPOS = `/users/alice/repos`;
const EVENTS = `/users/alice/events`;
// Primary path the gate tries: the student's fork <user>/<levelRepo>, same path.
const FORK_DIR = `alice/Python-Apprentice/contents/lessons/30_Loops`;
// A discovered fallback repo under a different name.
const STUDENT_REPO = 'league-python-student/level0-module3-alice';
const STUDENT_DIR = `${STUDENT_REPO}/contents/lessons/30_Loops`;

describe('checkRecipeCompletion', () => {
  it('complete when every required file exists in the student fork and differs from starter', async () => {
    mockGitHub({
      [CANON]: { status: 200, body: dir([['a.py', 'starterA'], ['b.py', 'starterB']]) },
      [FORK_DIR]: { status: 200, body: dir([['a.py', 'editedA'], ['b.py', 'editedB']]) },
    });
    const res = await checkRecipeCompletion({ githubUsername: 'alice', levelRepo: 'Python-Apprentice', lessonPath: 'lessons/30_Loops' });
    expect(res).toEqual({ complete: true, incomplete: [], checked: true });
  });

  it('reports a missing file and an unchanged (identical-to-starter) file as incomplete', async () => {
    mockGitHub({
      [CANON]: { status: 200, body: dir([['a.py', 'starterA'], ['b.py', 'starterB'], ['c.py', 'starterC']]) },
      // a.py edited; b.py identical to starter; c.py missing
      [FORK_DIR]: { status: 200, body: dir([['a.py', 'editedA'], ['b.py', 'starterB']]) },
    });
    const res = await checkRecipeCompletion({ githubUsername: 'alice', levelRepo: 'Python-Apprentice', lessonPath: 'lessons/30_Loops' });
    expect(res.complete).toBe(false);
    expect(res.checked).toBe(true);
    expect(res.incomplete.sort()).toEqual(['b.py', 'c.py']);
  });

  it('falls back to a discovered repo when the same-name fork is absent', async () => {
    mockGitHub({
      [CANON]: { status: 200, body: dir([['a.py', 'starterA']]) },
      // fork path 404s, but /users/alice/repos surfaces a differently-named repo
      [REPOS]: { status: 200, body: [{ full_name: STUDENT_REPO, fork: true, owner: { login: 'league-python-student' } }] },
      [STUDENT_DIR]: { status: 200, body: dir([['a.py', 'editedA']]) },
    });
    const res = await checkRecipeCompletion({ githubUsername: 'alice', levelRepo: 'Python-Apprentice', lessonPath: 'lessons/30_Loops' });
    expect(res).toEqual({ complete: true, incomplete: [], checked: true });
  });

  it('checked:false when no repo (fork or discovered) contains the lesson', async () => {
    mockGitHub({
      [CANON]: { status: 200, body: dir([['a.py', 'starterA']]) },
      [REPOS]: { status: 200, body: [] }, // no repos at all
      [EVENTS]: { status: 200, body: [] }, // events fallback also empty
    });
    const res = await checkRecipeCompletion({ githubUsername: 'alice', levelRepo: 'Python-Apprentice', lessonPath: 'lessons/30_Loops' });
    expect(res.checked).toBe(false);
    expect(res.complete).toBe(false);
    expect(res.incomplete).toContain('a.py');
  });

  it('does not block when the canonical directory has no recipe files', async () => {
    mockGitHub({
      [CANON]: { status: 200, body: dir([['README.md', 'x']]) },
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

  it('finds the lesson dir at the short path (lessons/ stripped) in the fork', async () => {
    mockGitHub({
      [CANON]: { status: 200, body: dir([['a.py', 'starterA']]) },
      // fork holds the dir at "30_Loops" (no lessons/ prefix)
      [`alice/Python-Apprentice/contents/30_Loops`]: { status: 200, body: dir([['a.py', 'editedA']]) },
    });
    const res = await checkRecipeCompletion({ githubUsername: 'alice', levelRepo: 'Python-Apprentice', lessonPath: 'lessons/30_Loops' });
    expect(res).toEqual({ complete: true, incomplete: [], checked: true });
  });
});
