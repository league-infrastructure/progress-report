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

function pushEvents(repos: string[]) {
  return repos.map((name) => ({ type: 'PushEvent', created_at: new Date().toISOString(), repo: { name } }));
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
const EVENTS = `/users/alice/events`;
// The student's discovered repo holds the lesson dir.
const STUDENT_REPO = 'league-python-student/level0-module3-alice';
const STUDENT_DIR = `${STUDENT_REPO}/contents/lessons/30_Loops`;

describe('checkRecipeCompletion', () => {
  it('complete when every required file exists in the discovered repo and differs from starter', async () => {
    mockGitHub({
      [CANON]: { status: 200, body: dir([['a.py', 'starterA'], ['b.py', 'starterB']]) },
      [EVENTS]: { status: 200, body: pushEvents([STUDENT_REPO]) },
      [STUDENT_DIR]: { status: 200, body: dir([['a.py', 'editedA'], ['b.py', 'editedB']]) },
    });
    const res = await checkRecipeCompletion({ githubUsername: 'alice', levelRepo: 'Python-Apprentice', lessonPath: 'lessons/30_Loops' });
    expect(res).toEqual({ complete: true, incomplete: [], checked: true });
  });

  it('reports a missing file and an unchanged (identical-to-starter) file as incomplete', async () => {
    mockGitHub({
      [CANON]: { status: 200, body: dir([['a.py', 'starterA'], ['b.py', 'starterB'], ['c.py', 'starterC']]) },
      [EVENTS]: { status: 200, body: pushEvents([STUDENT_REPO]) },
      // a.py edited; b.py identical to starter; c.py missing
      [STUDENT_DIR]: { status: 200, body: dir([['a.py', 'editedA'], ['b.py', 'starterB']]) },
    });
    const res = await checkRecipeCompletion({ githubUsername: 'alice', levelRepo: 'Python-Apprentice', lessonPath: 'lessons/30_Loops' });
    expect(res.complete).toBe(false);
    expect(res.checked).toBe(true);
    expect(res.incomplete.sort()).toEqual(['b.py', 'c.py']);
  });

  it('checked:false when the student has no LEAGUE repos containing the lesson', async () => {
    mockGitHub({
      [CANON]: { status: 200, body: dir([['a.py', 'starterA']]) },
      [EVENTS]: { status: 200, body: pushEvents([]) }, // no repos discovered
    });
    const res = await checkRecipeCompletion({ githubUsername: 'alice', levelRepo: 'Python-Apprentice', lessonPath: 'lessons/30_Loops' });
    expect(res.checked).toBe(false);
    expect(res.complete).toBe(false);
    expect(res.incomplete).toContain('a.py');
  });

  it('checked:false when the GitHub user does not exist (events 404)', async () => {
    mockGitHub({
      [CANON]: { status: 200, body: dir([['a.py', 'starterA']]) },
      [EVENTS]: { status: 404, body: { message: 'Not Found' } },
    });
    const res = await checkRecipeCompletion({ githubUsername: 'alice', levelRepo: 'Python-Apprentice', lessonPath: 'lessons/30_Loops' });
    expect(res.checked).toBe(false);
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

  it('finds the lesson dir at the short path (lessons/ stripped) in a module repo', async () => {
    mockGitHub({
      [CANON]: { status: 200, body: dir([['a.py', 'starterA']]) },
      [EVENTS]: { status: 200, body: pushEvents([STUDENT_REPO]) },
      // student repo holds the dir at "30_Loops" (no lessons/ prefix)
      [`${STUDENT_REPO}/contents/30_Loops`]: { status: 200, body: dir([['a.py', 'editedA']]) },
    });
    const res = await checkRecipeCompletion({ githubUsername: 'alice', levelRepo: 'Python-Apprentice', lessonPath: 'lessons/30_Loops' });
    expect(res).toEqual({ complete: true, incomplete: [], checked: true });
  });
});
