/**
 * Shared GitHub helpers for finding a student's LEAGUE curriculum repos.
 *
 * Both the monthly progress report (reviewGenerator) and the quiz recipe-
 * completion gate need to discover which GitHub repos belong to a student and
 * match our curriculum — using the student's GitHub events feed plus a LEAGUE
 * pattern/org filter, NOT a hardcoded repo name. This module is the single
 * source of truth for that logic.
 */

const GITHUB_API = 'https://api.github.com';

/** League org prefix is configurable; defaults to "league". */
export function leagueOrgPrefix(): string {
  return (process.env.LEAGUE_GITHUB_ORG_PREFIX ?? 'league').toLowerCase();
}

export function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'LEAGUE-Review-App',
  };
  if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

// A repo short-name that's recognisably a LEAGUE curriculum repo by name alone
// (e.g. Level1-Module0, level0-module3-alice, Python-Apprentice, Python-Games).
const LEAGUE_REPO_PATTERN = /^(level\d+[-_]module\d+|.*apprentice.*|.*games.*|.*league.*|.*curriculum.*)/i;

export function isLeagueRepoName(shortName: string): boolean {
  return LEAGUE_REPO_PATTERN.test(shortName);
}

interface GithubEvent {
  type: string;
  created_at: string;
  repo: { name: string };
}

/**
 * Discover the full names (owner/repo) of LEAGUE curriculum repos a student has
 * recently pushed to, via their public events feed. A repo qualifies if its
 * name matches the curriculum pattern, or (verified via the repo API) its owner
 * or fork-parent org starts with the league prefix.
 *
 * Fail-open per repo: if a repo can't be verified it's kept. Returns [] if the
 * user has no discoverable league repos. Throws only if the user doesn't exist.
 */
export async function discoverLeagueRepos(githubUsername: string): Promise<string[]> {
  const headers = ghHeaders();
  const fullNames = new Set<string>();

  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `${GITHUB_API}/users/${encodeURIComponent(githubUsername)}/events?per_page=100&page=${page}`,
      { headers },
    );
    if (page === 1 && res.status === 404) {
      throw new GitHubUserNotFoundError(githubUsername);
    }
    if (!res.ok) break;
    const events = (await res.json()) as GithubEvent[];
    if (events.length === 0) break;
    for (const e of events) {
      if (e.type === 'PushEvent' && e.repo?.name) fullNames.add(e.repo.name);
    }
  }

  const prefix = leagueOrgPrefix();
  const result: string[] = [];
  for (const fullRepo of fullNames) {
    const shortName = fullRepo.split('/').pop() ?? fullRepo;
    if (isLeagueRepoName(shortName)) {
      result.push(fullRepo);
      continue;
    }
    // Name doesn't obviously match — verify owner/parent org via the repo API.
    try {
      const res = await fetch(`${GITHUB_API}/repos/${fullRepo}`, { headers });
      if (!res.ok) {
        result.push(fullRepo); // can't verify — keep it
        continue;
      }
      const info = (await res.json()) as {
        owner: { login: string };
        parent?: { owner: { login: string } };
      };
      const ownerOrg = info.owner.login.toLowerCase();
      const parentOrg = info.parent?.owner.login.toLowerCase() ?? '';
      if (ownerOrg.startsWith(prefix) || parentOrg.startsWith(prefix)) result.push(fullRepo);
    } catch {
      result.push(fullRepo); // can't verify — keep it
    }
  }
  return result;
}

export class GitHubUserNotFoundError extends Error {
  constructor(username: string) {
    super(`GitHub user "${username}" not found`);
    this.name = 'GitHubUserNotFoundError';
  }
}
