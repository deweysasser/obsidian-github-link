/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { getSearchResultIssueStatus, IssueStatus } from "../../github/response";
import { getPullRequest, getReviewsForPR } from "../../github/github";
import { setIcon } from "obsidian";
import { setPRIcon } from "../../icon";
import { logger } from "../../plugin";
import { titleCase } from "../../util";
import { CommonIssuePRColumns, UserCell, type ColumnsMap } from "./base";
import type { TableResult } from "../types";
import type { UserResponse } from "../../github/response";
import type { PREnrichmentData } from "../../github/graphql-types";
import { getOrgRepoNumber } from "./utils";

async function getGraphQLData(row: TableResult[number]): Promise<PREnrichmentData | undefined> {
	const rowData = row as Record<string, unknown>;
	if (rowData._graphqlPromise) {
		await rowData._graphqlPromise;
	}
	return rowData._graphql as PREnrichmentData | undefined;
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
			const gql = await getGraphQLData(row);
			if (gql) {
				const latestByUser = new Map<string, string>();
				for (const review of gql.reviews) {
					if (review.state !== "COMMENTED" && review.state !== "PENDING") {
						latestByUser.set(review.login, review.state);
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
				return;
			}
			const info = getOrgRepoNumber(row);
			if (!info) {
				el.setText("-");
				return;
			}
			try {
				const reviews = await getReviewsForPR(info.org, info.repo, info.number);
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
			const gql = await getGraphQLData(row);
			if (gql) {
				if (gql.mergeable === "MERGEABLE") {
					el.setText("No");
				} else if (gql.mergeable === "CONFLICTING") {
					el.setText("Yes");
				} else {
					el.setText("-");
				}
				return;
			}
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
			} catch (err) {
				logger.debug(`Failed to load conflicts: ${err}`);
				el.setText("-");
			}
		},
	},
	mergeable: {
		header: "Mergeable",
		cell: async (row, el) => {
			const gql = await getGraphQLData(row);
			if (gql) {
				if (gql.mergeStateStatus) {
					el.setText(titleCase(gql.mergeStateStatus.toLowerCase()));
				} else {
					el.setText("-");
				}
				return;
			}
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
			} catch (err) {
				logger.debug(`Failed to load mergeable state: ${err}`);
				el.setText("-");
			}
		},
	},
	requested_reviewers: {
		header: "Reviewers",
		cell: async (row, el) => {
			const gql = await getGraphQLData(row);
			if (gql) {
				// Build review state map from GraphQL reviews
				const reviewStateByLogin = new Map<string, string>();
				const seenLogins = new Set<string>();
				const allUsers: Array<{ login: string; avatarUrl?: string; url?: string }> = [];

				for (const review of gql.reviews) {
					if (review.state !== "COMMENTED" && review.state !== "PENDING") {
						reviewStateByLogin.set(review.login, review.state);
					}
					if (!seenLogins.has(review.login)) {
						seenLogins.add(review.login);
						allUsers.push({ login: review.login });
					}
				}

				const teams: Array<{ slug: string; url: string }> = [];
				for (const rr of gql.reviewRequests) {
					if (!rr) continue;
					if ("login" in rr) {
						if (!seenLogins.has(rr.login)) {
							seenLogins.add(rr.login);
							allUsers.push({ login: rr.login, avatarUrl: rr.avatarUrl, url: rr.url });
						}
					} else if ("slug" in rr) {
						teams.push({ slug: rr.slug, url: rr.url });
					}
				}

				if (allUsers.length === 0 && teams.length === 0) {
					el.setText("-");
					return;
				}

				const wrapper = el.createDiv();
				for (const user of allUsers) {
					const reviewerWrapper = wrapper.createDiv({ cls: "github-link-table-author" });
					UserCell(
						{ login: user.login, html_url: user.url ?? `https://github.com/${user.login}`, avatar_url: user.avatarUrl ?? "" } as UserResponse,
						reviewerWrapper,
					);
					const state = reviewStateByLogin.get(user.login);
					if (state === "APPROVED") {
						const icon = reviewerWrapper.createSpan({ cls: "github-link-review-icon" });
						setIcon(icon, "lucide-check");
						icon.style.color = "var(--color-green)";
					} else if (state === "CHANGES_REQUESTED") {
						const icon = reviewerWrapper.createSpan({ cls: "github-link-review-icon" });
						setIcon(icon, "lucide-x");
						icon.style.color = "var(--color-red)";
					}
				}
				for (const team of teams) {
					const teamWrapper = wrapper.createDiv({ cls: "github-link-table-author" });
					const teamIcon = teamWrapper.createSpan({ cls: "github-link-review-icon" });
					setIcon(teamIcon, "lucide-users");
					const anchor = teamWrapper.createEl("a", {
						href: team.url ?? "#",
						attr: { target: "_blank" },
					});
					anchor.createSpan({ text: team.slug });
				}
				return;
			}

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
			const seenLogins = new Set<string>();
			const allUsers: Array<{ user: UserResponse; state?: string }> = [];
			if (reviewers) {
				for (const r of reviewers) {
					if (!r) continue;
					seenLogins.add(r.login);
					allUsers.push({ user: r });
				}
			}
			const reviewStateByLogin = new Map<string, string>();
			if (info) {
				try {
					const reviews = await getReviewsForPR(info.org, info.repo, info.number);
					for (const review of reviews) {
						const user = review.user;
						if (!user?.login) continue;
						const state = review.state;
						if (state && state !== "COMMENTED" && state !== "PENDING") {
							reviewStateByLogin.set(user.login, state);
						}
						if (!seenLogins.has(user.login)) {
							seenLogins.add(user.login);
							allUsers.push({ user: user as UserResponse });
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
			for (const entry of allUsers) {
				if (!entry.user) continue;
				const reviewerWrapper = wrapper.createDiv({ cls: "github-link-table-author" });
				UserCell(entry.user, reviewerWrapper);
				const state = reviewStateByLogin.get(entry.user.login);
				if (state === "APPROVED") {
					const icon = reviewerWrapper.createSpan({ cls: "github-link-review-icon" });
					setIcon(icon, "lucide-check");
					icon.style.color = "var(--color-green)";
				} else if (state === "CHANGES_REQUESTED") {
					const icon = reviewerWrapper.createSpan({ cls: "github-link-review-icon" });
					setIcon(icon, "lucide-x");
					icon.style.color = "var(--color-red)";
				}
			}
			if (teams) {
				for (const team of teams) {
					if (!team) continue;
					const teamWrapper = wrapper.createDiv({ cls: "github-link-table-author" });
					const teamIcon = teamWrapper.createSpan({ cls: "github-link-review-icon" });
					setIcon(teamIcon, "lucide-users");
					const anchor = teamWrapper.createEl("a", {
						href: team.html_url ?? "#",
						attr: { target: "_blank" },
					});
					anchor.createSpan({ text: team.slug });
				}
			}
		},
	},
};
