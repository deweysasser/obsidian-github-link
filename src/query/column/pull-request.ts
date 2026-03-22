/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { getSearchResultIssueStatus, IssueStatus } from "../../github/response";
import { getPullRequest, getReviewsForPR } from "../../github/github";
import { parseUrl, repoAPIToBrowserUrl } from "../../github/url-parse";
import { setPRIcon } from "../../icon";
import { titleCase } from "../../util";
import { CommonIssuePRColumns, UserCell, type ColumnsMap } from "./base";
import type { TableResult } from "../types";
import type { IssueListResponse, UserResponse } from "../../github/response";

function getOrgRepoNumber(row: TableResult[number]): { org: string; repo: string; number: number } | null {
	const repoUrl = (row as IssueListResponse[number]).repository_url;
	if (repoUrl) {
		const parsed = parseUrl(repoAPIToBrowserUrl(repoUrl));
		if (parsed?.org && parsed?.repo) {
			return { org: parsed.org, repo: parsed.repo, number: row.number };
		}
	}
	const parsed = parseUrl(row.html_url);
	if (parsed?.org && parsed?.repo) {
		return { org: parsed.org, repo: parsed.repo, number: row.number };
	}
	return null;
}

export const PullRequestColumns: ColumnsMap = {
	...CommonIssuePRColumns,
	status: {
		header: "Status",
		cell: (row, el) => {
			const wrapper = el.createDiv({ cls: "github-link-table-status" });
			const status = getSearchResultIssueStatus(row);
			const icon = wrapper.createSpan({ cls: "github-link-status-icon" });
			setPRIcon(icon, status);
			wrapper.createSpan({ text: status === IssueStatus.Done ? "Merged" : titleCase(status) });
		},
	},
	review_comments: {
		header: "Review Comments",
		cell: async (row, el) => {
			const count = (row as Record<string, unknown>).review_comments as number | undefined;
			if (count != null) {
				el.setText(`${count}`);
				return;
			}
			const info = getOrgRepoNumber(row);
			if (!info) {
				el.setText("-");
				return;
			}
			try {
				const pr = await getPullRequest(info.org, info.repo, info.number);
				el.setText(`${pr.review_comments}`);
			} catch {
				el.setText("-");
			}
		},
	},
	reviews: {
		header: "Reviews",
		cell: async (row, el) => {
			const info = getOrgRepoNumber(row);
			if (!info) {
				el.setText("-");
				return;
			}
			try {
				const reviews = await getReviewsForPR(info.org, info.repo, info.number);
				// Compute latest review state per reviewer
				const latestByUser = new Map<string, string>();
				for (const review of reviews) {
					const user = review.user?.login ?? "unknown";
					const state = review.state;
					if (state && state !== "COMMENTED") {
						latestByUser.set(user, state);
					}
				}
				if (latestByUser.size === 0) {
					el.setText("None");
					return;
				}
				const counts: Record<string, number> = {};
				for (const state of latestByUser.values()) {
					counts[state] = (counts[state] ?? 0) + 1;
				}
				const parts: string[] = [];
				for (const [state, count] of Object.entries(counts)) {
					const label = titleCase(state.toLowerCase().replace(/_/g, " "));
					parts.push(`${count} ${label}`);
				}
				el.setText(parts.join(", "));
			} catch {
				el.setText("-");
			}
		},
	},
	conflicts: {
		header: "Conflicts",
		cell: async (row, el) => {
			const info = getOrgRepoNumber(row);
			if (!info) {
				el.setText("-");
				return;
			}
			try {
				const pr = await getPullRequest(info.org, info.repo, info.number);
				if (pr.mergeable === true) {
					el.setText("No");
				} else if (pr.mergeable === false) {
					el.setText("Yes");
				} else {
					el.setText("-");
				}
			} catch {
				el.setText("-");
			}
		},
	},
	mergeable: {
		header: "Mergeable",
		cell: async (row, el) => {
			const info = getOrgRepoNumber(row);
			if (!info) {
				el.setText("-");
				return;
			}
			try {
				const pr = await getPullRequest(info.org, info.repo, info.number);
				const state = pr.mergeable_state;
				if (state) {
					el.setText(titleCase(state));
				} else {
					el.setText("-");
				}
			} catch {
				el.setText("-");
			}
		},
	},
	requested_reviewers: {
		header: "Requested Reviewers",
		cell: async (row, el) => {
			let reviewers = (row as Record<string, unknown>).requested_reviewers as
				| UserResponse[]
				| undefined;
			if (!reviewers) {
				const info = getOrgRepoNumber(row);
				if (!info) {
					el.setText("-");
					return;
				}
				try {
					const pr = await getPullRequest(info.org, info.repo, info.number);
					reviewers = pr.requested_reviewers as UserResponse[] | undefined;
				} catch {
					el.setText("-");
					return;
				}
			}
			if (!reviewers || reviewers.length === 0) {
				el.setText("-");
				return;
			}
			const wrapper = el.createDiv();
			for (const reviewer of reviewers) {
				UserCell(reviewer, wrapper);
			}
		},
	},
};
