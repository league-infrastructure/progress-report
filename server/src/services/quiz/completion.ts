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

import { ghHeaders, discoverLeagueRepos, GitHubUserNotFoundError } from '../github';

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

async function ghJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, data: (await res.json()) as T };
}

/** List the recipe files in a directory of a repo (canonical or student). */
async function listRecipeFiles(
  fullRepo: string,
  dirPath: string,
): Promise<{ ok: true; files: GitHubContentEntry[] } | { ok: false; status: number }> {
  const url = `${GITHUB_API}/repos/${fullRepo}/contents/${encodeURI(dirPath)}`;
  const res = await ghJson<GitHubContentEntry[] | GitHubContentEntry>(url);
  if (!res.ok) return res;
  const entries = Array.isArray(res.data) ? res.data : [res.data];
  const files = entries.filter(
    (e) => e.type === 'file' && RECIPE_EXTENSIONS.some((ext) => e.name.toLowerCase().endsWith(ext)),
  );
  return { ok: true, files };
}

/**
 * Find the student's repo that holds their copy of `lessonPath`. Mirrors the
 * progress-report process: discover the student's LEAGUE repos from their
 * GitHub activity (not a hardcoded name), then pick whichever one actually
 * contains the lesson directory.
 *
 * Returns the matching repo's recipe files, or a status describing why none
 * matched (so the caller can report "couldn't verify" vs "no work yet").
 */
async function findStudentLessonFiles(
  githubUsername: string,
  lessonPath: string,
): Promise<
  | { ok: true; files: GitHubContentEntry[]; repo: string }
  | { ok: false; reason: string }
> {
  let repos: string[];
  try {
    repos = await discoverLeagueRepos(githubUsername);
  } catch (err) {
    if (err instanceof GitHubUserNotFoundError) {
      return { ok: false, reason: `GitHub user @${githubUsername} not found.` };
    }
    return { ok: false, reason: `Couldn't read GitHub activity for @${githubUsername}.` };
  }
  if (repos.length === 0) {
    return { ok: false, reason: `No LEAGUE repos found for @${githubUsername}.` };
  }
  // The lesson directory may sit at the lesson's path, or one segment up
  // (some student module repos hold the lesson dir at the repo root).
  const candidates = [lessonPath, lessonPath.replace(/^lessons\//, '')];
  for (const repo of repos) {
    for (const dir of candidates) {
      const listed = await listRecipeFiles(repo, dir);
      if (listed.ok && listed.files.length > 0) {
        return { ok: true, files: listed.files, repo };
      }
    }
  }
  return { ok: false, reason: `No LEAGUE repo of @${githubUsername} contains ${lessonPath}.` };
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
  const canonical = await listRecipeFiles(`${CANONICAL_ORG}/${levelRepo}`, lessonPath);
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

  // 2. Discover the student's copy of that lesson (same process as the report).
  const student = await findStudentLessonFiles(githubUsername, lessonPath);
  if (!student.ok) {
    return {
      complete: false,
      incomplete: canonical.files.map((f) => f.name),
      checked: false,
      reason: student.reason,
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
