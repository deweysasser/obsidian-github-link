/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { getSearchResultIssueStatus, IssueStatus } from "../../github/response";
import { getPullRequest, getReviewsForPR } from "../../github/github";
import { parseUrl, repoAPIToBrowserUrl } from "../../github/url-parse";
import { setPRIcon } from "../../icon";
import { logger } from "../../plugin";
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
	if (parsed?.org && parsed?.repo && parsed?.pr != null) {
		return { org: parsed.org, repo: parsed.repo, number: parsed.pr };
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
			} catch (err) {
				logger.debug(`Failed to load review_comments: ${err}`);
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
				// Compute latest review state per reviewer, skipping comments and pending drafts
				const latestByUser = new Map<string, string>();
				for (const review of reviews) {
					const user = review.user?.login;
					if (!user) continue;
					const state = review.state;
					if (state && state !== "COMMENTED" && state !== "PENDING") {
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
			} catch (err) {
				logger.debug(`Failed to load reviews: ${err}`);
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
				// mergeable may be null if GitHub hasn't computed it yet
				const pr = await getPullRequest(info.org, info.repo, info.number);
				if (pr.mergeable === true) {
					el.setText("No");
				} else if (pr.mergeable === false) {
					el.setText("Yes");
				} else {
					el.setText("-");
				}
			} catch (err) {
				logger.debug(`Failed to load conflicts: ${err}`);
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
				// mergeable_state may be "unknown" if GitHub hasn't computed it yet
				const pr = await getPullRequest(info.org, info.repo, info.number);
				const state = pr.mergeable_state;
				if (state) {
					el.setText(titleCase(state));
				} else {
					el.setText("-");
				}
			} catch (err) {
				logger.debug(`Failed to load mergeable state: ${err}`);
				el.setText("-");
			}
		},
	},
	requested_reviewers: {
		header: "Reviewers",
		cell: async (row, el) => {
			const info = getOrgRepoNumber(row);
			const rowData = row as Record<string, unknown>;
			let reviewers = rowData.requested_reviewers as UserResponse[] | undefined;
			let teams = rowData.requested_teams as
				| Array<{ slug: string; html_url?: string }>
				| undefined;
			if (!reviewers && !teams && info) {
				try {
					const pr = await getPullRequest(info.org, info.repo, info.number);
					reviewers = pr.requested_reviewers as UserResponse[] | undefined;
					teams = pr.requested_teams as
						| Array<{ slug: string; html_url?: string }>
						| undefined;
				} catch (err) {
					logger.debug(`Failed to load requested_reviewers: ${err}`);
				}
			}
			// Also include reviewers who already submitted reviews
			const seenLogins = new Set<string>();
			const allUsers: UserResponse[] = [];
			if (reviewers) {
				for (const r of reviewers) {
					if (!r) continue;
					seenLogins.add(r.login);
					allUsers.push(r);
				}
			}
			if (info) {
				try {
					const reviews = await getReviewsForPR(info.org, info.repo, info.number);
					for (const review of reviews) {
						const user = review.user;
						if (user?.login && !seenLogins.has(user.login)) {
							seenLogins.add(user.login);
							allUsers.push(user as UserResponse);
						}
					}
				} catch (err) {
					logger.debug(`Failed to load reviews for reviewers column: ${err}`);
				}
			}
			if (allUsers.length === 0 && (!teams || teams.length === 0)) {
				el.setText("-");
				return;
			}
			const wrapper = el.createDiv();
			for (const user of allUsers) {
				UserCell(user, wrapper);
			}
			if (teams) {
				for (const team of teams) {
					if (!team) continue;
					const anchor = wrapper.createEl("a", {
						cls: "github-link-table-author",
						href: team.html_url ?? "#",
						attr: { target: "_blank" },
					});
					anchor.createSpan({ text: team.slug });
				}
			}
		},
	},
};
