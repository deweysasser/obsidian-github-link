import { parseUrl, repoAPIToBrowserUrl } from "../../github/url-parse";
import type { IssueListResponse } from "../../github/response";
import type { TableResult } from "../types";

export function getOrgRepoNumber(row: TableResult[number]): { org: string; repo: string; number: number } | null {
	const repoUrl = (row as IssueListResponse[number]).repository_url;
	if (repoUrl) {
		const parsed = parseUrl(repoAPIToBrowserUrl(repoUrl));
		if (parsed?.org && parsed?.repo) {
			return { org: parsed.org, repo: parsed.repo, number: row.number };
		}
	}
	const parsed = parseUrl(row.html_url);
	if (parsed?.org && parsed?.repo && parsed?.pr != null) {
		return { org: parsed.org, repo: parsed.repo, number: parsed.pr };
	}
	return null;
}
