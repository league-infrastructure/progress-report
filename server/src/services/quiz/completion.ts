/**
 * Recipe-completion gate for quiz assignment.
 *
 * A student may only be given a quiz for a lesson directory (e.g. `30_Loops`)
 * once they have completed every recipe file in that directory. Completion is
 * read from GitHub:
 *
 *   - Required files come from the CANONICAL course repo's lesson directory
 *     (league-curriculum/<repo>/<lessonPath>).
 *   - A file is "complete" when it exists in the STUDENT's repo AND its contents
 *     differ from the canonical starter (i.e. the student actually edited it).
 *
 * GitHub reads use GITHUB_TOKEN. Failures (missing repo, network, rate limit)
 * are reported as `checked: false` rather than thrown, so the assign flow can
 * decide how to handle "couldn't verify" without crashing.
 */

const GITHUB_API = 'https://api.github.com';

// The org that holds the canonical course repos (source of truth for the
// required file set and the starter contents).
export const CANONICAL_ORG = 'league-curriculum';

// Recipe files we treat as gradable. Notebooks and python files are the actual
// activity recipes; READMEs/images are not student work.
const RECIPE_EXTENSIONS = ['.py', '.ipynb'];

export interface CompletionResult {
  /** True only if every required recipe is complete. */
  complete: boolean;
  /** Recipe filenames the student still needs to finish. */
  incomplete: string[];
  /** False when we couldn't read GitHub (missing fork, network, auth, rate limit). */
  checked: boolean;
  /** Human-readable reason when checked === false. */
  reason?: string;
}

interface GitHubContentEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  sha: string;
}

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Resolve the STUDENT's repo (owner + repo name) that holds their copy of a
 * level's lessons.
 *
 * !!! REPO MAPPING — confirm the exact convention before relying on the gate !!!
 * Per the stakeholder, each student has a fork of the org course repo under
 * their own GitHub account, named the same as the canonical repo. If the real
 * convention differs (e.g. league-python-student/level<N>-module<M>-<username>),
 * change ONLY this function — everything else is mapping-agnostic.
 */
export function resolveStudentRepo(
  githubUsername: string,
  levelRepo: string,
): { owner: string; repo: string } {
  return { owner: githubUsername, repo: levelRepo };
}

async function ghJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, data: (await res.json()) as T };
}

/** List the recipe files in a directory of a repo (canonical or student). */
async function listRecipeFiles(
  owner: string,
  repo: string,
  dirPath: string,
): Promise<{ ok: true; files: GitHubContentEntry[] } | { ok: false; status: number }> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURI(dirPath)}`;
  const res = await ghJson<GitHubContentEntry[] | GitHubContentEntry>(url);
  if (!res.ok) return res;
  const entries = Array.isArray(res.data) ? res.data : [res.data];
  const files = entries.filter(
    (e) => e.type === 'file' && RECIPE_EXTENSIONS.some((ext) => e.name.toLowerCase().endsWith(ext)),
  );
  return { ok: true, files };
}

/** Fetch a file's git blob SHA (cheap identity check); null if absent. */
async function fileSha(owner: string, repo: string, filePath: string): Promise<string | null> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURI(filePath)}`;
  const res = await ghJson<GitHubContentEntry>(url);
  if (!res.ok) return null;
  return res.data.sha ?? null;
}

/**
 * Check whether `githubUsername` has completed every recipe in `lessonPath`
 * for the level whose canonical repo is `levelRepo`.
 *
 * "Complete" = file present in the student's repo AND its git blob SHA differs
 * from the canonical starter's SHA (content changed). Git's blob SHA is a
 * content hash, so equal SHA === identical bytes === untouched starter.
 */
export async function checkRecipeCompletion(params: {
  githubUsername: string | null;
  levelRepo: string | null;
  lessonPath: string;
}): Promise<CompletionResult> {
  const { githubUsername, levelRepo, lessonPath } = params;

  if (!githubUsername) {
    return { complete: false, incomplete: [], checked: false, reason: 'Student has no GitHub username on file.' };
  }
  if (!levelRepo) {
    return { complete: false, incomplete: [], checked: false, reason: 'This level has no GitHub repo configured.' };
  }

  // 1. Required files = recipes in the canonical lesson directory.
  const canonical = await listRecipeFiles(CANONICAL_ORG, levelRepo, lessonPath);
  if (!canonical.ok) {
    return {
      complete: false,
      incomplete: [],
      checked: false,
      reason: `Couldn't read the course directory ${lessonPath} (HTTP ${canonical.status}).`,
    };
  }
  if (canonical.files.length === 0) {
    // Nothing to complete — don't block.
    return { complete: true, incomplete: [], checked: true };
  }
  const starterSha = new Map(canonical.files.map((f) => [f.name, f.sha]));

  // 2. The student's copy of that directory.
  const { owner, repo } = resolveStudentRepo(githubUsername, levelRepo);
  const student = await listRecipeFiles(owner, repo, lessonPath);
  if (!student.ok) {
    return {
      complete: false,
      incomplete: canonical.files.map((f) => f.name),
      checked: false,
      reason:
        student.status === 404
          ? `No ${repo} repo found for ${owner} (or the ${lessonPath} directory is missing).`
          : `Couldn't read ${owner}/${repo} (HTTP ${student.status}).`,
    };
  }
  const studentSha = new Map(student.files.map((f) => [f.name, f.sha]));

  // 3. Each required file must exist in the student repo AND differ from starter.
  const incomplete: string[] = [];
  for (const [name, starter] of starterSha) {
    const theirs = studentSha.get(name);
    if (!theirs || theirs === starter) {
      incomplete.push(name);
    }
  }

  return { complete: incomplete.length === 0, incomplete, checked: true };
}
